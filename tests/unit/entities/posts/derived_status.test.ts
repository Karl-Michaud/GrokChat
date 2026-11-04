import { describe, expect, it } from "vitest";
import { xPostId } from "../../../../src/entities/identity/ids";
import { derivedStatus } from "../../../../src/entities/posts/derived_status";
import { missed } from "../../../../src/entities/posts/missed";
import {
  attemptTime,
  PART_STATE_KINDS,
  PENDING,
  type PartState,
} from "../../../../src/entities/posts/part_state";
import {
  allPartsPending,
  anyPartIn,
  currentPartIndex,
  LIFECYCLES,
} from "../../../../src/entities/posts/post";
import { MINUTE } from "../../../../src/entities/time/instant";
import { aPost, part, sendingState, sentState, T0, unknownState } from "../../support/builders";

const REJECTED: PartState = { kind: "REJECTED", reason: "no" };
const NOT_FOUND: PartState = { kind: "NOT_FOUND", attemptAt: T0 };
const DELETED: PartState = { kind: "DELETED", xPostId: xPostId("x") };

const done = (...states: PartState[]) =>
  aPost({
    lifecycle: "DONE",
    parts: states.map((state, index) => part(`p${String(index)}`, state)),
  });

describe("derivedStatus", () => {
  it.each(LIFECYCLES.filter((lifecycle) => lifecycle !== "DONE"))(
    "%s reports its lifecycle",
    (lifecycle) => {
      expect(derivedStatus(aPost({ lifecycle }))).toBe(lifecycle);
    },
  );

  it.each([
    ["PUBLISHED", [sentState("a"), sentState("b")]],
    ["PARTIALLY_PUBLISHED", [sentState("a"), REJECTED]],
    ["PARTIALLY_PUBLISHED", [sentState("a"), PENDING]],
    ["FAILED", [REJECTED, PENDING]],
    ["UNKNOWN_OUTCOME", [sentState("a"), unknownState()]],
    ["UNKNOWN_OUTCOME", [NOT_FOUND, unknownState()]],
    ["NOT_FOUND", [sentState("a"), NOT_FOUND]],
    ["NOT_FOUND", [DELETED, NOT_FOUND]],
    ["DELETED", [DELETED, DELETED]],
    ["DELETED", [DELETED, REJECTED]],
    ["DELETE_INCOMPLETE", [sentState("a"), DELETED]],
  ] as const)("DONE with parts → %s", (status, states) => {
    expect(derivedStatus(done(...states))).toBe(status);
  });
});

describe("missed", () => {
  const grace = 10 * MINUTE;
  it("only a SCHEDULED post with every part PENDING, strictly after publishAt + grace", () => {
    const post = aPost({ lifecycle: "SCHEDULED", publishAt: T0 });
    expect(missed(post, T0 + grace, grace)).toBe(false);
    expect(missed(post, T0 + grace + 1, grace)).toBe(true);
    expect(missed(aPost({ lifecycle: "RESUMING" }), T0 + 2 * grace, grace)).toBe(false);
    const started = aPost({ lifecycle: "SCHEDULED", parts: [part("a", sendingState())] });
    expect(missed(started, T0 + 2 * grace, grace)).toBe(false);
  });
});

describe("part and post helpers", () => {
  it("lists every lifecycle and part state", () => {
    expect(LIFECYCLES).toStrictEqual([
      "DRAFT",
      "PENDING_REVIEW",
      "SCHEDULED",
      "RESUMING",
      "PUBLISHING",
      "DONE",
      "CANCELLED",
      "MISSED",
    ]);
    expect(PART_STATE_KINDS).toStrictEqual([
      "PENDING",
      "SENDING",
      "SENT",
      "UNKNOWN",
      "NOT_FOUND",
      "REJECTED",
      "DELETED",
    ]);
  });

  it("attemptTime: the send attempt for SENDING, SENT and UNKNOWN only", () => {
    expect(attemptTime(sendingState(T0 + 1))).toBe(T0 + 1);
    expect(attemptTime(sentState("a", T0 + 2))).toBe(T0 + 2);
    expect(attemptTime(unknownState(0, T0 + 3))).toBe(T0 + 3);
    for (const state of [PENDING, NOT_FOUND, REJECTED, DELETED]) {
      expect(attemptTime(state)).toBeNull();
    }
  });

  it("allPartsPending, anyPartIn, currentPartIndex", () => {
    const post = aPost({ parts: [part("a", sentState("x")), part("b"), part("c")] });
    expect(allPartsPending(post)).toBe(false);
    expect(allPartsPending(aPost({ parts: [part("a"), part("b")] }))).toBe(true);
    expect(anyPartIn(post, "SENT")).toBe(true);
    expect(anyPartIn(post, "UNKNOWN")).toBe(false);
    expect(currentPartIndex(post)).toBe(1);
    expect(currentPartIndex(aPost({ parts: [part("a", sentState("x"))] }))).toBe(-1);
  });
});
