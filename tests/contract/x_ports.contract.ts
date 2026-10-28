/**
 * Contracts for the X ports (plan §6), run against the in-memory fakes and the fetch drivers
 * alike. Failures are compared by what they mean (`mapXOutcome`), since a driver's detail text
 * comes from X's body.
 */
import { assert, expect, it } from "vitest";
import { xPostId, type XPostId } from "../../src/entities/identity/ids";
import { MINUTE, SECOND, type Instant } from "../../src/entities/time/instant";
import type { RateScope, XResult } from "../../src/entities/x/x_failure";
import { mapXOutcome, type XOutcome } from "../../src/entities/x/x_outcome";
import type { XMediaUploader } from "../../src/use_cases/ports/x_media_uploader";
import type { XMetricsReader } from "../../src/use_cases/ports/x_metrics_reader";
import type { XOwnTimelineReader } from "../../src/use_cases/ports/x_own_timeline_reader";
import type { XPublisher } from "../../src/use_cases/ports/x_publisher";
import type { XUserMetricsReader } from "../../src/use_cases/ports/x_user_metrics_reader";
import { ACCOUNT, T0 } from "../unit/support/builders";

/** What the next X call does, in terms every implementation can be scripted with. */
export type Scripted =
  | { readonly kind: "not_sent" }
  | { readonly kind: "no_response" }
  | { readonly kind: "rate_limited"; readonly scope: RateScope; readonly retryAt: Instant }
  | { readonly kind: "status"; readonly status: 400 | 401 | 403 | 503 }
  | { readonly kind: "content_refused" };

export interface Scriptable {
  script(next: Scripted): void;
}

const RESET = T0 + 15 * MINUTE;

/** Each scripted failure and the outcome every implementation must produce for it. */
export const FAILURE_CASES: readonly (readonly [Scripted, XOutcome["kind"], Instant | null])[] = [
  [{ kind: "not_sent" }, "retryable", T0 + MINUTE],
  [{ kind: "no_response" }, "unknown", null],
  [{ kind: "status", status: 503 }, "unknown", null],
  [{ kind: "rate_limited", scope: "user", retryAt: RESET }, "rate_limited", RESET],
  [{ kind: "rate_limited", scope: "app", retryAt: RESET }, "app_rate_limited", RESET],
  [{ kind: "status", status: 401 }, "needs_reconnect", null],
  [{ kind: "status", status: 403 }, "needs_reconnect", null],
  [{ kind: "content_refused" }, "rejected", null],
  [{ kind: "status", status: 400 }, "rejected", null],
];

function expectOutcome<T>(
  result: XResult<T>,
  kind: XOutcome["kind"],
  retryAt: Instant | null,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  const outcome = mapXOutcome(result.failure, T0);
  expect(outcome.kind).toBe(kind);
  if (retryAt !== null) {
    expect(outcome).toMatchObject({ retryAt });
  }
}

async function eachFailure<T>(harness: Scriptable, call: () => Promise<XResult<T>>) {
  for (const [scripted, kind, retryAt] of FAILURE_CASES) {
    harness.script(scripted);
    expectOutcome(await call(), kind, retryAt);
  }
}

export function xPublisherContract(make: () => Scriptable & { publisher: XPublisher }): void {
  it("creates a post, with media or as a reply, and returns its id", async () => {
    const { publisher } = make();
    const first = await publisher.create(ACCOUNT, "hello", [], null);
    expect(first.ok).toBe(true);
    const reply = first.ok ? first.value : xPostId("none");
    expect(typeof reply).toBe("string");
    const second = await publisher.create(ACCOUNT, "part 2", [], reply);
    expect(second.ok && second.value !== reply).toBe(true);
  });

  it("maps every create and delete failure to its outcome", async () => {
    const harness = make();
    await eachFailure(harness, () => harness.publisher.create(ACCOUNT, "t", [], null));
    await eachFailure(harness, () => harness.publisher.delete(ACCOUNT, xPostId("1")));
  });

  it("deletes a post", async () => {
    const { publisher } = make();
    const made = await publisher.create(ACCOUNT, "to delete", [], null);
    const id = made.ok ? made.value : xPostId("none");
    expect(await publisher.delete(ACCOUNT, id)).toStrictEqual({ ok: true, value: null });
  });
}

export function xMediaUploaderContract(make: () => Scriptable & { uploader: XMediaUploader }) {
  it("uploads a photo and a GIF, each to a media id", async () => {
    const { uploader } = make();
    const photo = await uploader.upload(ACCOUNT, new Uint8Array([0xff, 0xd8, 0xff]), "PHOTO");
    const gif = await uploader.upload(ACCOUNT, new Uint8Array([0x47, 0x49, 0x46, 0x38]), "GIF");
    expect(photo.ok && gif.ok && photo.value !== gif.value).toBe(true);
  });

  it("maps every upload failure to its outcome", async () => {
    const harness = make();
    const bytes = new Uint8Array([1, 2, 3]);
    await eachFailure(harness, () => harness.uploader.upload(ACCOUNT, bytes, "PHOTO"));
    await eachFailure(harness, () => harness.uploader.upload(ACCOUNT, bytes, "GIF"));
  });
}

export interface SeededPost {
  readonly text: string;
  readonly createdAt: Instant;
  readonly inReplyTo: XPostId | null;
}

export function xTimelineContract(
  make: () => Scriptable & {
    reader: XOwnTimelineReader;
    seed(posts: readonly SeededPost[]): Promise<readonly XPostId[]>;
  },
): void {
  it("returns the oldest posts at or after `since`, oldest first, at most maxResults", async () => {
    const harness = make();
    const at = (seconds: number) => T0 + seconds * SECOND;
    const ids = await harness.seed([
      { text: "before", createdAt: at(-1), inReplyTo: null },
      { text: "c", createdAt: at(30), inReplyTo: null },
      { text: "a", createdAt: at(0), inReplyTo: null },
      { text: "b", createdAt: at(10), inReplyTo: xPostId("p0") },
      { text: "d", createdAt: at(40), inReplyTo: null },
    ]);
    const result = await harness.reader.recent(ACCOUNT, T0, 3);
    expect(result).toStrictEqual({
      ok: true,
      value: [
        { id: ids[2], text: "a", createdAt: at(0), inReplyTo: null },
        { id: ids[3], text: "b", createdAt: at(10), inReplyTo: xPostId("p0") },
        { id: ids[1], text: "c", createdAt: at(30), inReplyTo: null },
      ],
    });
    expect(await harness.reader.recent(ACCOUNT, at(41), 5)).toStrictEqual({ ok: true, value: [] });
  });

  it("maps every read failure to its outcome", async () => {
    const harness = make();
    await eachFailure(harness, () => harness.reader.recent(ACCOUNT, T0, 5));
    await eachFailure(harness, () => harness.reader.page(ACCOUNT, T0, null));
  });

  it("pages the posts at or after `since`, newest first, 100 a page (GROKCHAT-19)", async () => {
    const harness = make();
    const at = (seconds: number) => T0 + seconds * SECOND;
    const seeded = Array.from({ length: 101 }, (_, index) => ({
      text: `p${String(index)}`,
      createdAt: at(index),
      inReplyTo: index === 100 ? xPostId("p0") : null,
    }));
    const ids = await harness.seed([
      { text: "old", createdAt: at(-1), inReplyTo: null },
      ...seeded,
    ]);
    const first = await harness.reader.page(ACCOUNT, T0, null);
    assert(first.ok);
    expect(first.value.posts).toHaveLength(100);
    expect(first.value.posts[0]).toStrictEqual({
      id: ids[101],
      text: "p100",
      createdAt: at(100),
      inReplyTo: xPostId("p0"),
    });
    expect(first.value.next).not.toBeNull();
    const second = await harness.reader.page(ACCOUNT, T0, first.value.next);
    expect(second).toStrictEqual({
      ok: true,
      value: { posts: [{ id: ids[1], text: "p0", createdAt: at(0), inReplyTo: null }], next: null },
    });
    expect(await harness.reader.page(ACCOUNT, at(101), null)).toStrictEqual({
      ok: true,
      value: { posts: [], next: null },
    });
  });
}

export function xMetricsContract(
  make: () => Scriptable & {
    reader: XMetricsReader;
    seed(ids: readonly XPostId[]): void;
    now: Instant;
  },
): void {
  it("reads the posts it can find, stamped with the account and the time", async () => {
    const harness = make();
    harness.seed([xPostId("11"), xPostId("12")]);
    const result = await harness.reader.read(ACCOUNT, [xPostId("11"), xPostId("12"), xPostId("9")]);
    expect(result.ok).toBe(true);
    const snapshots = result.ok ? result.value : [];
    expect(snapshots.map((s) => [s.xPostId, s.accountId, s.takenAt])).toStrictEqual([
      [xPostId("11"), ACCOUNT, harness.now],
      [xPostId("12"), ACCOUNT, harness.now],
    ]);
  });

  it("no ids is an empty read; more than 100 is refused before sending", async () => {
    const { reader } = make();
    expect(await reader.read(ACCOUNT, [])).toStrictEqual({ ok: true, value: [] });
    const many = Array.from({ length: 101 }, (_, i) => xPostId(String(i)));
    expect(await reader.read(ACCOUNT, many)).toStrictEqual({
      ok: false,
      failure: { kind: "not_sent" },
    });
  });

  it("maps every read failure to its outcome", async () => {
    const harness = make();
    await eachFailure(harness, () => harness.reader.read(ACCOUNT, [xPostId("1")]));
  });
}

/** The account's own follower counts (GROKCHAT-15). */
export function xUserMetricsContract(
  make: () => Scriptable & { reader: XUserMetricsReader; setFollowers(count: number): void },
): void {
  it("reads the account's follower counts", async () => {
    const harness = make();
    harness.setFollowers(4_321);
    const result = await harness.reader.read(ACCOUNT);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.followers : null).toBe(4_321);
    for (const count of Object.values(result.ok ? result.value : {})) {
      expect(Number.isSafeInteger(count) && count >= 0).toBe(true);
    }
  });

  it("maps every read failure to its outcome", async () => {
    const harness = make();
    await eachFailure(harness, () => harness.reader.read(ACCOUNT));
  });
}
