import { invocationBudget } from "../../entities/budget/budget";
import type { AccountId, PostId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type {
  AccountMetricsCollector,
  MetricsSummary,
} from "../../use_cases/ports/account_metrics_collector";
import type { AccountPublisher, PublishSummary } from "../../use_cases/ports/account_publisher";
import type { AccountReconciler, ReconcileSummary } from "../../use_cases/ports/account_reconciler";
import type { CollectAccountMetrics } from "../../use_cases/run_services/collect_account_metrics";
import type { PublishPost } from "../../use_cases/run_services/publish_post";
import type { ReconcileAccount } from "../../use_cases/run_services/reconcile_account";
import { MemoryBudgetMeter } from "./memory_budget";

/**
 * The account Durable Object's methods without the Durable Object: each call gets a fresh
 * invocation budget, as each DO invocation has its own (U16).
 */
export class InProcessAccountPublisher implements AccountPublisher {
  readonly meters: MemoryBudgetMeter[] = [];

  constructor(private readonly service: PublishPost) {}

  private meter(deadline: Instant): MemoryBudgetMeter {
    const meter = new MemoryBudgetMeter(invocationBudget(deadline));
    this.meters.push(meter);
    return meter;
  }

  publishDue(account: AccountId, _now: Instant, deadline: Instant): Promise<PublishSummary> {
    return this.service.publishDue(account, this.meter(deadline));
  }

  publishNow(account: AccountId, post: PostId, deadline: Instant): Promise<PublishSummary> {
    return this.service.publishNow(account, post, this.meter(deadline));
  }
}

export class InProcessAccountReconciler implements AccountReconciler {
  constructor(private readonly service: ReconcileAccount) {}

  reconcile(account: AccountId, _now: Instant, deadline: Instant): Promise<ReconcileSummary> {
    return this.service.reconcile(account, new MemoryBudgetMeter(invocationBudget(deadline)));
  }
}

export class InProcessMetricsCollector implements AccountMetricsCollector {
  constructor(private readonly service: CollectAccountMetrics) {}

  collect(account: AccountId, _now: Instant, deadline: Instant): Promise<MetricsSummary> {
    return this.service.collect(account, new MemoryBudgetMeter(invocationBudget(deadline)));
  }
}
