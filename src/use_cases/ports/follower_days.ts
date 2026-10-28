import type { AccountId } from "../../entities/identity/ids";
import type { FollowerSnapshot } from "../../entities/metrics/follower_snapshot";
import type { Instant } from "../../entities/time/instant";

/**
 * The once-per-UTC-day rule of the follower snapshot (GROKCHAT-15), held in storage so it survives
 * every reset: a day is claimed before X is called, and only a read that never left gives it back.
 */
export interface FollowerDays {
  /** True when this call claimed the account's `day`; false when it was already claimed. */
  claim(account: AccountId, day: string, at: Instant): Promise<boolean>;
  /** Gives the day back after a read that never reached X, so a later tick may try again. */
  release(account: AccountId, day: string): Promise<void>;
  /** Stores the counts on the day's claim. */
  record(snapshot: FollowerSnapshot): Promise<void>;
}

/** Which accounts the metrics tick should visit for their follower snapshot. */
export interface FollowerSchedule {
  /** Connected accounts (ACTIVE or PAUSED) whose `day` is not claimed yet, by account id. */
  accountsDue(day: string): Promise<readonly AccountId[]>;
}
