import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { increments, perPost, totalIn } from "../../../../src/entities/analytics/increments";
import {
  engagements,
  METRIC_KEYS,
  minus,
  plus,
  sum,
  valuesOf,
  ZERO,
} from "../../../../src/entities/analytics/metric_values";
import { xPostId } from "../../../../src/entities/identity/ids";
import { HOUR } from "../../../../src/entities/time/instant";
import { aSnapshot, OTHER_ACCOUNT, T0 } from "../../support/builders";

const values = (impressions: number, likes = 0) => ({ ...ZERO, impressions, likes });

describe("metric values (GROKCHAT-15)", () => {
  it("reads a snapshot, with absent clicks as 0", () => {
    expect(
      valuesOf(aSnapshot("a", T0, 100, { urlLinkClicks: 7, userProfileClicks: null })),
    ).toStrictEqual({
      impressions: 100,
      likes: 10,
      reposts: 2,
      replies: 1,
      quotes: 0,
      bookmarks: 4,
      linkClicks: 7,
      profileClicks: 0,
    });
    expect(METRIC_KEYS).toHaveLength(8);
  });

  it("engagements are every interaction and click, never impressions", () => {
    const all = {
      impressions: 1000,
      likes: 1,
      reposts: 2,
      replies: 3,
      quotes: 4,
      bookmarks: 5,
      linkClicks: 6,
      profileClicks: 7,
    };
    expect(engagements(all)).toBe(28);
    expect(engagements(ZERO)).toBe(0);
  });

  it("property: plus and minus are inverse, field by field; sum folds plus", () => {
    const metric = fc.record({
      impressions: fc.integer({ min: -1e6, max: 1e6 }),
      likes: fc.integer({ min: -1e6, max: 1e6 }),
      reposts: fc.integer({ min: -1e6, max: 1e6 }),
      replies: fc.integer({ min: -1e6, max: 1e6 }),
      quotes: fc.integer({ min: -1e6, max: 1e6 }),
      bookmarks: fc.integer({ min: -1e6, max: 1e6 }),
      linkClicks: fc.integer({ min: -1e6, max: 1e6 }),
      profileClicks: fc.integer({ min: -1e6, max: 1e6 }),
    });
    fc.assert(
      fc.property(metric, metric, (a, b) => {
        expect(minus(plus(a, b), b)).toStrictEqual({ ...a });
        expect(sum([a, b])).toStrictEqual(plus(a, b));
        for (const key of METRIC_KEYS) {
          expect(plus(a, b)[key]).toBe(a[key] + b[key]);
        }
      }),
    );
  });
});

describe("metric increments (GROKCHAT-15)", () => {
  it("each read gains its counts minus the post's previous read", () => {
    const found = increments([
      aSnapshot("a", T0 + 2 * HOUR, 300),
      aSnapshot("a", T0, 100),
      aSnapshot("b", T0 + HOUR, 50),
      aSnapshot("a", T0 + 3 * HOUR, 250),
    ]);
    expect(found.map((item) => [item.xPostId, item.at, item.values.impressions])).toStrictEqual([
      [xPostId("a"), T0, 100],
      [xPostId("b"), T0 + HOUR, 50],
      [xPostId("a"), T0 + 2 * HOUR, 200],
      [xPostId("a"), T0 + 3 * HOUR, -50],
    ]);
    const window = { from: T0 + HOUR, to: T0 + 3 * HOUR };
    expect(totalIn(found, window).impressions).toBe(250);
    expect(
      [...perPost(found, window)].map(([id, gained]) => [id, gained.impressions]),
    ).toStrictEqual([
      [xPostId("b"), 50],
      [xPostId("a"), 200],
    ]);
  });

  it("keeps the account; ties in time go by post id", () => {
    const found = increments([
      aSnapshot("b", T0, 1, { accountId: OTHER_ACCOUNT }),
      aSnapshot("a", T0, 2),
    ]);
    expect(found.map((item) => [item.xPostId, item.accountId])).toStrictEqual([
      [xPostId("a"), "acc-1"],
      [xPostId("b"), OTHER_ACCOUNT],
    ]);
  });

  it("property: a window's gain is its last read minus the last read before it", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 100 }), fc.nat({ max: 10_000 })), {
          minLength: 1,
          maxLength: 30,
        }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (reads, a, b) => {
          const unique = [...new Map(reads.map(([hour, count]) => [hour, count]))];
          const snapshots = unique.map(([hour, count]) => aSnapshot("p", T0 + hour * HOUR, count));
          const window = { from: T0 + Math.min(a, b) * HOUR, to: T0 + Math.max(a, b) * HOUR };
          const lastBefore = (at: number) =>
            snapshots
              .filter((s) => s.takenAt < at)
              .sort((x, y) => x.takenAt - y.takenAt)
              .at(-1)?.impressions ?? 0;
          const gained = totalIn(increments(snapshots), window).impressions;
          expect(gained).toBe(lastBefore(window.to) - lastBefore(window.from));
          expect(totalIn(increments(snapshots), { from: 0, to: T0 + 200 * HOUR })).toStrictEqual(
            valuesOf(
              snapshots.sort((x, y) => x.takenAt - y.takenAt).at(-1) ?? aSnapshot("p", 0, 0),
            ),
          );
        },
      ),
    );
  });

  it("an empty history gains nothing", () => {
    expect(totalIn(increments([]), { from: 0, to: T0 })).toStrictEqual(values(0));
    expect(perPost([], { from: 0, to: T0 }).size).toBe(0);
  });
});
