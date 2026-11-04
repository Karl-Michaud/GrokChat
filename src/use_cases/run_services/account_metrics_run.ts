import type { AccountId } from "../../entities/identity/ids";
import type { MetricsSummary } from "../ports/account_metrics_collector";
import type { BudgetMeter } from "../ports/budget_meter";
import type { CollectAccountMetrics } from "./collect_account_metrics";
import type { SnapshotFollowers } from "./snapshot_followers";

/** One metrics call to an account's Durable Object, within one invocation's meter. */
export interface AccountMetricsRun {
  collect(account: AccountId, meter: BudgetMeter): Promise<MetricsSummary>;
}

/**
 * The metrics tick's work in the account's object (plan §3.3 #8, GROKCHAT-15): the posts whose
 * metrics are due, then the day's follower snapshot, each its own single-flight run.
 */
export class PostsThenFollowers implements AccountMetricsRun {
  constructor(
    private readonly posts: CollectAccountMetrics,
    private readonly followers: SnapshotFollowers,
  ) {}

  async collect(account: AccountId, meter: BudgetMeter): Promise<MetricsSummary> {
    const posts = await this.posts.collect(account, meter);
    const followers = (await this.followers.snapshot(account, meter)) ? 1 : 0;
    return { ran: posts.ran, read: posts.read, followers };
  }
}
