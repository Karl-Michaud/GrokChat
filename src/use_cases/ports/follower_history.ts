import type { AccountId } from "../../entities/identity/ids";
import type { FollowerSnapshot } from "../../entities/metrics/follower_snapshot";
import type { TimeWindow } from "../../entities/time/instant";

/** The recorded follower snapshots behind follower growth (GROKCHAT-15). */
export interface FollowerHistory {
  /**
   * Every recorded snapshot taken in the window, of one account or of all (null), and each
   * account's newest recorded snapshot from before it. Claims with no counts are left out.
   * Oldest first.
   */
  history(account: AccountId | null, window: TimeWindow): Promise<readonly FollowerSnapshot[]>;
}
