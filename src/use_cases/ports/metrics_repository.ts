import type { AccountId, XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { TimeWindow } from "../../entities/time/instant";

export interface MetricsRepository {
  addSnapshots(snapshots: readonly MetricsSnapshot[]): Promise<void>;
  /** Every snapshot of the account's posts taken in the window, oldest first. */
  series(account: AccountId, window: TimeWindow): Promise<readonly MetricsSnapshot[]>;
  /** The newest snapshot of each post that has one. */
  latest(xPostIds: readonly XPostId[]): Promise<readonly MetricsSnapshot[]>;
}
