import type { AccountId, XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { XResult } from "../../entities/x/x_failure";

/** At most 100 ids per call (plan §3.3 #8). */
export interface XMetricsReader {
  read(
    account: AccountId,
    xPostIds: readonly XPostId[],
  ): Promise<XResult<readonly MetricsSnapshot[]>>;
}
