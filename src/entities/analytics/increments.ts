import type { AccountId, XPostId } from "../identity/ids";
import type { MetricsSnapshot } from "../metrics/metrics_snapshot";
import { inWindow, type Instant, type TimeWindow } from "../time/instant";
import { minus, sum, valuesOf, ZERO, type MetricValues } from "./metric_values";

/** What a post gained between one read and the one before it (GROKCHAT-15). */
export interface MetricIncrement {
  readonly xPostId: XPostId;
  readonly accountId: AccountId;
  readonly at: Instant;
  readonly values: MetricValues;
}

/**
 * Snapshots are cumulative, so each read's gain is its counts minus the post's previous read (its
 * first read gains everything since the post went up). The gain is dated at the read, which is
 * how a period's numbers add up: a window's total is the sum of the gains read inside it. A count
 * that went down (an unlike) is a negative gain.
 */
export function increments(snapshots: readonly MetricsSnapshot[]): readonly MetricIncrement[] {
  const ordered = [...snapshots].sort(
    (a, b) => a.takenAt - b.takenAt || a.xPostId.localeCompare(b.xPostId),
  );
  const last = new Map<XPostId, MetricValues>();
  return ordered.map((snapshot) => {
    const values = valuesOf(snapshot);
    const before = last.get(snapshot.xPostId) ?? ZERO;
    last.set(snapshot.xPostId, values);
    return {
      xPostId: snapshot.xPostId,
      accountId: snapshot.accountId,
      at: snapshot.takenAt,
      values: minus(values, before),
    };
  });
}

export function totalIn(found: readonly MetricIncrement[], window: TimeWindow): MetricValues {
  return sum(found.filter((item) => inWindow(window, item.at)).map((item) => item.values));
}

/** Each post's gains inside the window, in the order the posts first gained. */
export function perPost(
  found: readonly MetricIncrement[],
  window: TimeWindow,
): ReadonlyMap<XPostId, MetricValues> {
  const posts = new Map<XPostId, MetricValues>();
  for (const item of found.filter((each) => inWindow(window, each.at))) {
    posts.set(item.xPostId, sum([posts.get(item.xPostId) ?? ZERO, item.values]));
  }
  return posts;
}
