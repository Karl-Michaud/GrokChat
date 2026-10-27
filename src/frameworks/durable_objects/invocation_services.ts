import { invocationBudget } from "../../entities/budget/budget";
import type { AccountId, PostId, XPostId } from "../../entities/identity/ids";
import { MINUTE, type Instant, type Millis } from "../../entities/time/instant";
import type { TokenSet } from "../../entities/x/token_set";
import type {
  AccountMetricsCollector,
  MetricsSummary,
} from "../../use_cases/ports/account_metrics_collector";
import type { AccountPublisher, PublishSummary } from "../../use_cases/ports/account_publisher";
import type { AccountReconciler, ReconcileSummary } from "../../use_cases/ports/account_reconciler";
import type { AccountXGateway, DeleteOutcome } from "../../use_cases/ports/account_x_gateway";
import type { BudgetMeter } from "../../use_cases/ports/budget_meter";
import type { Clock } from "../../use_cases/ports/clock";
import type { AccessTokenResult, TokenProvider } from "../../use_cases/ports/token_provider";
import type { CollectAccountMetrics } from "../../use_cases/run_services/collect_account_metrics";
import type { PublishPost } from "../../use_cases/run_services/publish_post";
import type { ReconcileAccount } from "../../use_cases/run_services/reconcile_account";
import { MemoryBudgetMeter } from "../memory/memory_budget";

/**
 * One invocation's piece of the account's use-case graph, built around that invocation's meter
 * (plan §3.5): the X drivers in it spend from the meter, so they cannot be shared across
 * invocations that run at the same time in one object.
 */
export type PerInvocation<T> = (account: AccountId, meter: BudgetMeter) => T;

const meterUntil = (deadline: Instant): MemoryBudgetMeter =>
  new MemoryBudgetMeter(invocationBudget(deadline));

/**
 * The account Durable Object's methods: each call gets a fresh invocation budget, as each DO
 * invocation has its own (U16), and the graph built for it.
 */
export class InvocationAccountPublisher implements AccountPublisher {
  /** Every meter handed out, oldest first, so tests can read each call's budget. */
  readonly meters: MemoryBudgetMeter[] = [];

  constructor(private readonly build: PerInvocation<PublishPost>) {}

  publishDue(account: AccountId, _now: Instant, deadline: Instant): Promise<PublishSummary> {
    const meter = this.meter(deadline);
    return this.build(account, meter).publishDue(account, meter);
  }

  publishNow(account: AccountId, post: PostId, deadline: Instant): Promise<PublishSummary> {
    const meter = this.meter(deadline);
    return this.build(account, meter).publishNow(account, post, meter);
  }

  private meter(deadline: Instant): MemoryBudgetMeter {
    const meter = meterUntil(deadline);
    this.meters.push(meter);
    return meter;
  }
}

export class InvocationAccountReconciler implements AccountReconciler {
  constructor(private readonly build: PerInvocation<ReconcileAccount>) {}

  reconcile(account: AccountId, _now: Instant, deadline: Instant): Promise<ReconcileSummary> {
    const meter = meterUntil(deadline);
    return this.build(account, meter).reconcile(account, meter);
  }
}

export class InvocationMetricsCollector implements AccountMetricsCollector {
  constructor(private readonly build: PerInvocation<CollectAccountMetrics>) {}

  collect(account: AccountId, _now: Instant, deadline: Instant): Promise<MetricsSummary> {
    const meter = meterUntil(deadline);
    return this.build(account, meter).collect(account, meter);
  }
}

/**
 * The deadline of a delete or a token store, which carry none: long enough for a token refresh
 * (whose un-aborted worst case is a minute, plan §3.5) and then the deletes, so a delete on an
 * idle account whose token expired still goes through. The MCP caller may stop waiting at 60 s;
 * the object finishes, and its outcome is in the audit.
 */
export const GATEWAY_WINDOW: Millis = 2 * MINUTE;

export class InvocationAccountXGateway implements AccountXGateway {
  constructor(
    private readonly build: PerInvocation<AccountXGateway>,
    private readonly clock: Clock,
  ) {}

  deletePost(account: AccountId, xPostIds: readonly XPostId[]): Promise<readonly DeleteOutcome[]> {
    return this.gateway(account).deletePost(account, xPostIds);
  }

  storeConnectedTokens(account: AccountId, tokens: TokenSet): Promise<void> {
    return this.gateway(account).storeConnectedTokens(account, tokens);
  }

  private gateway(account: AccountId): AccountXGateway {
    return this.build(account, meterUntil(this.clock.now() + GATEWAY_WINDOW));
  }
}

/** A token asked for on its own: the caller's deadline is the invocation's. */
export class InvocationTokenProvider implements TokenProvider {
  constructor(private readonly build: PerInvocation<TokenProvider>) {}

  accessToken(account: AccountId, deadline: Instant): Promise<AccessTokenResult> {
    return this.build(account, meterUntil(deadline)).accessToken(account, deadline);
  }
}
