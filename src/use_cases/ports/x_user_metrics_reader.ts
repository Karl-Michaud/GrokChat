import type { AccountId } from "../../entities/identity/ids";
import type { UserPublicMetrics } from "../../entities/metrics/follower_snapshot";
import type { XResult } from "../../entities/x/x_failure";

/** The account's own `public_metrics` on X: one User read, $0.010 (GROKCHAT-15). */
export interface XUserMetricsReader {
  read(account: AccountId): Promise<XResult<UserPublicMetrics>>;
}
