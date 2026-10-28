import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ZERO } from "../../../../src/entities/analytics/metric_values";
import {
  comparePosts,
  pageOf,
  POST_SORT_KEYS,
  type Sortable,
} from "../../../../src/entities/analytics/post_sort";
import { postId } from "../../../../src/entities/identity/ids";
import { T0 } from "../../support/builders";

const post = (id: string, at: number, impressions: number | null, likes = 0): Sortable => ({
  id: postId(id),
  publishAt: at,
  metrics: impressions === null ? null : { ...ZERO, impressions, likes, linkClicks: likes },
});

const ids = (items: readonly Sortable[]) => items.map((item) => item.id);

describe("the posts page's order (GROKCHAT-15)", () => {
  const items = [
    post("a", T0, 10),
    post("b", T0 + 1, null),
    post("c", T0 + 2, 30),
    post("d", T0 + 3, 10),
  ];

  it("time, newest or oldest first", () => {
    expect(ids([...items].sort(comparePosts("time", "desc")))).toStrictEqual(["d", "c", "b", "a"]);
    expect(ids([...items].sort(comparePosts("time", "asc")))).toStrictEqual(["a", "b", "c", "d"]);
  });

  it("a metric either way; never-read posts last; ties newest first", () => {
    expect(ids([...items].sort(comparePosts("impressions", "desc")))).toStrictEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
    expect(ids([...items].sort(comparePosts("impressions", "asc")))).toStrictEqual([
      "d",
      "a",
      "c",
      "b",
    ]);
    const engaged = [post("x", T0, 100, 1), post("y", T0, 1, 5)];
    expect(ids([...engaged].sort(comparePosts("engagements", "desc")))).toStrictEqual(["y", "x"]);
    expect(ids([...engaged].sort(comparePosts("engagements", "asc")))).toStrictEqual(["x", "y"]);
    expect(ids([...engaged].sort(comparePosts("linkClicks", "desc")))).toStrictEqual(["y", "x"]);
    expect(
      ids([post("q", T0, 1), post("p", T0, 1)].sort(comparePosts("likes", "desc"))),
    ).toStrictEqual(["p", "q"]);
  });

  it("lists every key", () => {
    expect(POST_SORT_KEYS).toStrictEqual([
      "time",
      "impressions",
      "engagements",
      "likes",
      "reposts",
      "replies",
      "linkClicks",
    ]);
  });

  it("property: a total order, so any input order sorts the same", () => {
    const arbitrary = fc.uniqueArray(
      fc.record({
        id: fc.stringMatching(/^[a-z]{1,4}$/),
        at: fc.integer({ min: 0, max: 5 }),
        impressions: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
      }),
      { selector: (item) => item.id, maxLength: 12 },
    );
    fc.assert(
      fc.property(
        arbitrary,
        fc.constantFrom(...POST_SORT_KEYS),
        fc.constantFrom("asc" as const, "desc" as const),
        (raw, key, direction) => {
          const list = raw.map((item) => post(item.id, T0 + item.at, item.impressions));
          const order = comparePosts(key, direction);
          const sorted = ids([...list].sort(order));
          expect(ids([...list].reverse().sort(order))).toStrictEqual(sorted);
          for (const a of list) {
            expect(Math.abs(order(a, a))).toBe(0);
            for (const b of list) {
              expect(Math.sign(order(a, b)) + Math.sign(order(b, a))).toBe(0);
            }
          }
          const firstNull = sorted.findIndex(
            (id) => list.find((p) => p.id === id)?.metrics === null,
          );
          if (key !== "time" && firstNull >= 0) {
            expect(
              sorted
                .slice(firstNull)
                .every((id) => list.find((p) => p.id === id)?.metrics === null),
            ).toBe(true);
          }
        },
      ),
    );
  });
});

describe("pageOf", () => {
  it("cuts 1-based pages, clamping out-of-range pages", () => {
    const items = [1, 2, 3, 4, 5];
    expect(pageOf(items, 1, 2)).toStrictEqual({ items: [1, 2], page: 1, pages: 3 });
    expect(pageOf(items, 3, 2)).toStrictEqual({ items: [5], page: 3, pages: 3 });
    expect(pageOf(items, 9, 2)).toStrictEqual({ items: [5], page: 3, pages: 3 });
    expect(pageOf(items, 0, 2)).toStrictEqual({ items: [1, 2], page: 1, pages: 3 });
    expect(pageOf([], 1, 2)).toStrictEqual({ items: [], page: 1, pages: 1 });
  });

  it("property: the pages partition the list in order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { maxLength: 60 }),
        fc.integer({ min: 1, max: 10 }),
        (items, size) => {
          const { pages } = pageOf(items, 1, size);
          const joined = Array.from(
            { length: pages },
            (_, i) => pageOf(items, i + 1, size).items,
          ).flat();
          expect(joined).toStrictEqual(items);
          expect(pages).toBe(Math.max(1, Math.ceil(items.length / size)));
        },
      ),
    );
  });
});
