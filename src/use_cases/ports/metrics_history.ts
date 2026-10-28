import type { AccountId, XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { TimeWindow } from "../../entities/time/instant";

/** The metrics snapshots behind the dashboard's analytics (GROKCHAT-15). */
export interface MetricsHistory {
  /**
   * Every snapshot taken in the window, of one account or of all (null), and for each post read
   * in it also its newest snapshot from before the window, so its first gain in the window is
   * measured from there. Oldest first.
   */
  history(account: AccountId | null, window: TimeWindow): Promise<readonly MetricsSnapshot[]>;
  /** Every snapshot of these posts, oldest first. */
  postSeries(xPostIds: readonly XPostId[]): Promise<readonly MetricsSnapshot[]>;
}
