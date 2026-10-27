import type { AccountId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";

export interface ReconcileSummary {
  /** False when another reconcile for the account was already running (single-flight, m2). */
  readonly ran: boolean;
  readonly found: number;
  readonly notFound: number;
}

export interface AccountReconciler {
  reconcile(account: AccountId, now: Instant, deadline: Instant): Promise<ReconcileSummary>;
}
