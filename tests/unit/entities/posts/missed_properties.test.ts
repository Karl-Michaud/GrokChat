/** fast-check properties for `missed` (plan §5 tests, §3.1.1): lifecycle × parts × times. */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { xPostId } from "../../../../src/entities/identity/ids";
import { missed } from "../../../../src/entities/posts/missed";
import type { PartState, PartStateKind } from "../../../../src/entities/posts/part_state";
import { PART_STATE_KINDS } from "../../../../src/entities/posts/part_state";
import { LIFECYCLES, type Lifecycle, type Post } from "../../../../src/entities/posts/post";
import { backToQueue } from "../../../../src/entities/posts/post_parts";
import { DAY } from "../../../../src/entities/time/instant";
import { aPost, part, T0 } from "../../support/builders";

const STATES: Readonly<Record<PartStateKind, PartState>> = {
  PENDING: { kind: "PENDING" },
  SENDING: { kind: "SENDING", attemptAt: T0 },
  SENT: { kind: "SENT", xPostId: xPostId("x-1"), at: T0 },
  UNKNOWN: { kind: "UNKNOWN", attemptAt: T0, checks: 0 },
  NOT_FOUND: { kind: "NOT_FOUND", attemptAt: T0 },
  REJECTED: { kind: "REJECTED", reason: "no" },
  DELETED: { kind: "DELETED", xPostId: xPostId("x-1") },
};

const instant = fc.integer({ min: T0 - DAY, max: T0 + DAY });
const grace = fc.integer({ min: 0, max: DAY });
const kinds = fc.array(fc.constantFrom(...PART_STATE_KINDS), { minLength: 1, maxLength: 4 });

const postArb = fc
  .record({
    lifecycle: fc.constantFrom<Lifecycle>(...LIFECYCLES),
    kinds,
    publishAt: instant,
    resumeAt: fc.option(instant, { nil: null }),
  })
  .map(({ lifecycle, kinds: states, publishAt, resumeAt }) =>
    aPost({
      lifecycle,
      publishAt,
      resumeAt,
      parts: states.map((kind, index) => part(`p${String(index)}`, STATES[kind])),
    }),
  );

const allPending = (post: Post): boolean => post.parts.every((p) => p.state.kind === "PENDING");

describe("missed: properties", () => {
  it("true exactly when SCHEDULED, all parts PENDING, now > max(publishAt, resumeAt) + grace", () => {
    fc.assert(
      fc.property(postArb, instant, grace, (post, now, g) => {
        const since = Math.max(post.publishAt, post.resumeAt ?? post.publishAt);
        const expected = post.lifecycle === "SCHEDULED" && allPending(post) && now > since + g;
        expect(missed(post, now, g)).toBe(expected);
      }),
    );
  });

  it("a post not SCHEDULED, or with any part not PENDING, is never missed", () => {
    const notMissable = postArb.filter((p) => p.lifecycle !== "SCHEDULED" || !allPending(p));
    fc.assert(
      fc.property(notMissable, instant, grace, (post, now, g) => {
        expect(missed(post, now, g)).toBe(false);
      }),
    );
  });

  it("a first part sent back to the queue is not missed before its not-before time + grace", () => {
    const pending = postArb.map((p) => ({
      ...p,
      parts: p.parts.map((x) => ({ ...x, state: STATES.PENDING })),
    }));
    fc.assert(
      fc.property(
        pending,
        instant,
        grace,
        fc.integer({ min: 0, max: DAY }),
        (post, at, g, wait) => {
          const queued = backToQueue({ ...post, lifecycle: "PUBLISHING" }, at);
          const notBefore = Math.max(post.publishAt, at);
          expect(queued.lifecycle).toBe("SCHEDULED");
          expect(missed(queued, notBefore + Math.min(wait, g), g)).toBe(false);
          expect(missed(queued, notBefore + g + 1 + wait, g)).toBe(true);
        },
      ),
    );
  });
});
