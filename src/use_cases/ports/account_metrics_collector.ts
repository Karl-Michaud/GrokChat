import type { AccountId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";

export interface MetricsSummary {
  readonly ran: boolean;
  readonly read: number;
}

export interface AccountMetricsCollector {
  collect(account: AccountId, now: Instant, deadline: Instant): Promise<MetricsSummary>;
}
