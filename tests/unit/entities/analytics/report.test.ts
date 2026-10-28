import { describe, expect, it } from "vitest";
import { increments } from "../../../../src/entities/analytics/increments";
import { rangeWindow } from "../../../../src/entities/analytics/range";
import {
  accountTotals,
  bucketSeries,
  publishedAt,
  publishedIn,
  topPosts,
  xIdsOf,
} from "../../../../src/entities/analytics/report";
import { postId, xPostId } from "../../../../src/entities/identity/ids";
import { DAY, HOUR } from "../../../../src/entities/time/instant";
import {
  aFollowerSnapshot,
  aPost,
  aSnapshot,
  OTHER_ACCOUNT,
  part,
  sentState,
  T0,
} from "../../support/builders";

const deleted = { kind: "DELETED", xPostId: xPostId("d1") } as const;

describe("analytics report builders (GROKCHAT-15)", () => {
  const one = aPost({
    id: postId("one"),
    lifecycle: "DONE",
    parts: [part("first", sentState("x1", T0 - HOUR)), part("second", sentState("x2", T0 - HOUR))],
  });
  const two = aPost({
    id: postId("two"),
    accountId: OTHER_ACCOUNT,
    lifecycle: "DONE",
    parts: [part("other", sentState("y1", T0 - 2 * DAY))],
  });
  const gone = aPost({ id: postId("gone"), lifecycle: "DONE", parts: [part("bye", deleted)] });
  const waiting = aPost({ id: postId("waiting") });

  it("publishedAt is the first part's send; xIdsOf every sent or deleted part", () => {
    expect(publishedAt(one)).toBe(T0 - HOUR);
    expect([publishedAt(gone), publishedAt(waiting)]).toStrictEqual([null, null]);
    expect(xIdsOf(one)).toStrictEqual([xPostId("x1"), xPostId("x2")]);
    expect(xIdsOf(gone)).toStrictEqual([xPostId("d1")]);
    expect(xIdsOf(waiting)).toStrictEqual([]);
    expect(publishedIn([one, two, gone, waiting], { from: T0 - DAY, to: T0 })).toBe(1);
  });

  it("buckets the gains, the posts published and the followers", () => {
    const range = rangeWindow("7d", T0, null);
    const gains = increments([
      aSnapshot("x1", T0 - 2 * DAY, 10),
      aSnapshot("x1", T0 - HOUR, 40),
      aSnapshot("y1", T0 - 3 * HOUR, 5, { accountId: OTHER_ACCOUNT }),
    ]);
    const followers = [aFollowerSnapshot(T0 - 3 * DAY, 100), aFollowerSnapshot(T0 - HOUR, 104)];
    const buckets = bucketSeries(range, gains, followers, [one, two, gone]);
    expect(buckets.map((b) => b.values.impressions)).toStrictEqual([0, 0, 0, 0, 10, 0, 35]);
    expect(buckets.map((b) => b.published)).toStrictEqual([0, 0, 0, 0, 1, 0, 1]);
    expect(buckets.map((b) => b.followers)).toStrictEqual([null, null, null, 100, 100, 100, 104]);
    expect(buckets.map((b) => b.start)).toStrictEqual(range.starts);
  });

  it("gains and posts outside the range's buckets are left out", () => {
    const range = rangeWindow("24h", T0, null);
    const gains = increments([aSnapshot("x1", T0 - 3 * DAY, 10)]);
    const old = aPost({ lifecycle: "DONE", parts: [part("old", sentState("z", T0 - 3 * DAY))] });
    const buckets = bucketSeries(range, gains, [], [old]);
    expect(buckets.every((b) => b.values.impressions === 0 && b.published === 0)).toBe(true);
    expect(buckets.every((b) => b.followers === null)).toBe(true);
  });

  it("top posts: by engagements, then impressions, then id; parts summed, unread parts skipped; at most the limit", () => {
    const window = { from: T0 - DAY, to: T0 };
    const gains = increments([
      aSnapshot("x1", T0 - HOUR, 100),
      aSnapshot("x2", T0 - HOUR, 100),
      aSnapshot("y1", T0 - HOUR, 1000, { likes: 1, reposts: 0, replies: 0, bookmarks: 0 }),
      aSnapshot("d1", T0 - HOUR, 50),
      aSnapshot("x1", T0 - 3 * DAY, 1),
    ]);
    const top = topPosts([one, two, gone, waiting], gains, window, 2);
    expect(top.map((p) => [p.postId, p.values.impressions])).toStrictEqual([
      [postId("one"), 199],
      [postId("gone"), 50],
    ]);
    expect(top[0]).toMatchObject({
      accountId: one.accountId,
      text: "first second",
      xPostId: xPostId("x1"),
      publishedAt: T0 - HOUR,
    });
    expect(top[1]?.publishedAt).toBeNull();
    expect(topPosts([two], gains, window, 5).map((p) => p.values.impressions)).toStrictEqual([
      1000,
    ]);
    const tie = [
      aPost({
        id: postId("b"),
        lifecycle: "DONE",
        parts: [part("t", sentState("t1", T0 - 2 * HOUR))],
      }),
      aPost({
        id: postId("a"),
        lifecycle: "DONE",
        parts: [part("t", sentState("t2", T0 - 2 * HOUR))],
      }),
    ];
    const even = increments([aSnapshot("t1", T0 - HOUR, 10), aSnapshot("t2", T0 - HOUR, 10)]);
    expect(topPosts(tie, even, window, 5).map((p) => p.postId)).toStrictEqual([
      postId("a"),
      postId("b"),
    ]);
    const later = [
      aPost({
        id: postId("old"),
        lifecycle: "DONE",
        parts: [part("t", sentState("t1", T0 - 5 * HOUR))],
      }),
      aPost({
        id: postId("new"),
        lifecycle: "DONE",
        parts: [part("t", sentState("t2", T0 - 2 * HOUR))],
      }),
    ];
    expect(topPosts(later, even, window, 5).map((p) => p.postId)).toStrictEqual([
      postId("new"),
      postId("old"),
    ]);
    expect(
      topPosts([aPost({ id: postId("empty"), lifecycle: "DONE", parts: [] })], even, window, 5),
    ).toStrictEqual([]);
  });

  it("a part with no gain in the window adds nothing to its post", () => {
    const window = { from: T0 - DAY, to: T0 };
    const partly = increments([aSnapshot("x1", T0 - HOUR, 70)]);
    expect(topPosts([one], partly, window, 5).map((p) => p.values.impressions)).toStrictEqual([70]);
  });

  it("a post with no parts or never sent is never published, in any window", () => {
    const empty = aPost({ parts: [] });
    expect([publishedAt(empty), xIdsOf(empty)]).toStrictEqual([null, []]);
    expect(publishedIn([waiting, gone, empty], { from: -1, to: T0 + DAY })).toBe(0);
  });

  it("an account's totals count only its own gains in the window", () => {
    const gains = increments([
      aSnapshot("x1", T0 - HOUR, 10),
      aSnapshot("y1", T0 - HOUR, 7, { accountId: OTHER_ACCOUNT }),
      aSnapshot("x2", T0 + HOUR, 9),
    ]);
    expect(accountTotals(gains, OTHER_ACCOUNT, { from: T0 - DAY, to: T0 }).impressions).toBe(7);
    expect(accountTotals(gains, one.accountId, { from: T0 - DAY, to: T0 }).impressions).toBe(10);
  });
});
