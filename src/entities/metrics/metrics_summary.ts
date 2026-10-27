import type { MetricName, MetricsSnapshot } from "./metrics_snapshot";

/** The newest snapshot of each post in a series (snapshots are cumulative, so the newest counts). */
export function newestPerPost(series: readonly MetricsSnapshot[]): readonly MetricsSnapshot[] {
  const newest = new Map<string, MetricsSnapshot>();
  for (const snapshot of series) {
    const current = newest.get(snapshot.xPostId);
    if (current === undefined || snapshot.takenAt >= current.takenAt) {
      newest.set(snapshot.xPostId, snapshot);
    }
  }
  return [...newest.values()];
}

export function metricTotals(
  snapshots: readonly MetricsSnapshot[],
): Readonly<Record<MetricName, number>> {
  const sum = (name: MetricName): number =>
    snapshots.reduce((total, snapshot) => total + snapshot[name], 0);
  return {
    impressions: sum("impressions"),
    likes: sum("likes"),
    reposts: sum("reposts"),
    replies: sum("replies"),
    quotes: sum("quotes"),
    bookmarks: sum("bookmarks"),
  };
}

/** Best first by `metric`; ties by post id, so the order is stable. */
export function rankBy(
  snapshots: readonly MetricsSnapshot[],
  metric: MetricName,
): readonly MetricsSnapshot[] {
  return [...snapshots].sort((a, b) => b[metric] - a[metric] || a.xPostId.localeCompare(b.xPostId));
}
