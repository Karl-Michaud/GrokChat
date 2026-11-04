import {
  InvocationAccountPublisher,
  InvocationAccountReconciler,
  InvocationMetricsCollector,
} from "../durable_objects/invocation_services";
import type { AccountMetricsRun } from "../../use_cases/run_services/account_metrics_run";
import type { PublishPost } from "../../use_cases/run_services/publish_post";
import type { ReconcileAccount } from "../../use_cases/run_services/reconcile_account";

/**
 * The account Durable Object's methods without the Durable Object, over one fixed graph (the
 * stubs take no meter): each call still gets a fresh invocation budget, as each DO invocation
 * has its own (U16).
 */
export class InProcessAccountPublisher extends InvocationAccountPublisher {
  constructor(service: PublishPost) {
    super(() => service);
  }
}

export class InProcessAccountReconciler extends InvocationAccountReconciler {
  constructor(service: ReconcileAccount) {
    super(() => service);
  }
}

export class InProcessMetricsCollector extends InvocationMetricsCollector {
  constructor(service: AccountMetricsRun) {
    super(() => service);
  }
}
