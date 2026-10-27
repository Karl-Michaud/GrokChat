import { describe, expect, it } from "vitest";
import { xPostId } from "../../../../src/entities/identity/ids";
import type { MetricsSnapshot } from "../../../../src/entities/metrics/metrics_snapshot";
import {
  metricTotals,
  newestPerPost,
  rankBy,
} from "../../../../src/entities/metrics/metrics_summary";
import { ACCOUNT, T0 } from "../../support/builders";

const snap = (id: string, takenAt: number, n: number): MetricsSnapshot => ({
  xPostId: xPostId(id),
  accountId: ACCOUNT,
  takenAt,
  impressions: n,
  likes: n + 1,
  reposts: n + 2,
  replies: n + 3,
  quotes: n + 4,
  bookmarks: n + 5,
  urlLinkClicks: null,
  userProfileClicks: null,
});

describe("metrics summaries", () => {
  it("newestPerPost keeps the newest snapshot of each post, whatever the order; a tie keeps the later", () => {
    const series = [snap("a", T0 + 2, 2), snap("a", T0 + 1, 1), snap("b", T0, 5), snap("b", T0, 6)];
    expect(newestPerPost(series)).toStrictEqual([snap("a", T0 + 2, 2), snap("b", T0, 6)]);
    expect(newestPerPost([])).toStrictEqual([]);
  });

  it("metricTotals sums each metric", () => {
    expect(metricTotals([snap("a", T0, 1), snap("b", T0, 10)])).toStrictEqual({
      impressions: 11,
      likes: 13,
      reposts: 15,
      replies: 17,
      quotes: 19,
      bookmarks: 21,
    });
    expect(metricTotals([])).toStrictEqual({
      impressions: 0,
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
    });
  });

  it("rankBy: best first, ties by id, without changing the input", () => {
    const input = [snap("b", T0, 1), snap("c", T0, 3), snap("a", T0, 1)];
    expect(rankBy(input, "quotes").map((s) => s.xPostId)).toStrictEqual(["c", "a", "b"]);
    expect(input.map((s) => s.xPostId)).toStrictEqual(["b", "c", "a"]);
  });
});
