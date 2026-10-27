import { DISPATCH_COST } from "../../entities/budget/budget";
import type { AccountId, PostId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type {
  AccountMetricsCollector,
  MetricsSummary,
} from "../../use_cases/ports/account_metrics_collector";
import type { AccountPublisher, PublishSummary } from "../../use_cases/ports/account_publisher";
import type { AccountReconciler, ReconcileSummary } from "../../use_cases/ports/account_reconciler";
import type { BudgetMeter } from "../../use_cases/ports/budget_meter";

export type AccountDispatch = AccountPublisher & AccountReconciler & AccountMetricsCollector;

const { cloudflareCalls, externalSubrequests } = DISPATCH_COST;

/**
 * The port decorator that spends the tick's budget on its fan-out (plan §3.2, U16): each call to
 * an account's Durable Object is one of the Worker invocation's 1,000 Cloudflare-service calls,
 * spent before the call is made, whatever becomes of it.
 */
export class MeteredAccountDispatch implements AccountDispatch {
  constructor(
    private readonly inner: AccountDispatch,
    private readonly meter: BudgetMeter,
  ) {}

  publishDue(account: AccountId, now: Instant, deadline: Instant): Promise<PublishSummary> {
    this.spend();
    return this.inner.publishDue(account, now, deadline);
  }

  publishNow(account: AccountId, post: PostId, deadline: Instant): Promise<PublishSummary> {
    this.spend();
    return this.inner.publishNow(account, post, deadline);
  }

  reconcile(account: AccountId, now: Instant, deadline: Instant): Promise<ReconcileSummary> {
    this.spend();
    return this.inner.reconcile(account, now, deadline);
  }

  collect(account: AccountId, now: Instant, deadline: Instant): Promise<MetricsSummary> {
    this.spend();
    return this.inner.collect(account, now, deadline);
  }

  private spend(): void {
    this.meter.spend({ cloudflareCalls, externalSubrequests });
  }
}
