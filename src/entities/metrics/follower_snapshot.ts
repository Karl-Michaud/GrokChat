import type { AccountId } from "../identity/ids";
import type { Instant } from "../time/instant";

/** A user's `public_metrics` (`GET /2/users/:id?user.fields=public_metrics`, docs.x.com). */
export interface UserPublicMetrics {
  readonly followers: number;
  readonly following: number;
  readonly posts: number;
  readonly listed: number;
}

/** One account's follower counts, read once per UTC day (GROKCHAT-15). */
export interface FollowerSnapshot extends UserPublicMetrics {
  readonly accountId: AccountId;
  /** The UTC day the read belongs to, `YYYY-MM-DD`: at most one billed read per account and day. */
  readonly day: string;
  readonly takenAt: Instant;
}

/** The UTC calendar day of an instant, `YYYY-MM-DD`. */
export function utcDay(instant: Instant): string {
  return new Date(instant).toISOString().slice(0, 10);
}
