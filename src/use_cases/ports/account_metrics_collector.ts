import type { AccountId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";

/**
 * What one account's metrics run did: posts made outside GrokChat imported, posts read, and
 * whether the day's follower read was made.
 */
export interface MetricsSummary {
  readonly ran: boolean;
  /** New posts found on the account's timeline that GrokChat did not publish (GROKCHAT-19). */
  readonly imported: number;
  readonly read: number;
  /** 1 when the run made the account's follower read for the day (GROKCHAT-15), else 0. */
  readonly followers: number;
}

export interface AccountMetricsCollector {
  collect(account: AccountId, now: Instant, deadline: Instant): Promise<MetricsSummary>;
}
