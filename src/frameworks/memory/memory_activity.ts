import { actionMatches, ACTIVITY_ACTIONS } from "../../entities/analytics/activity_kind";
import type { CostEstimate } from "../../entities/costs/estimate_cost";
import type { AuditEvent } from "../../entities/records/audit_event";
import { inWindow } from "../../entities/time/instant";
import type { ActivityFilter, ActivityLog, ActivityPage } from "../../use_cases/ports/activity_log";
import type { MemoryAuditLog, MemoryCostLedger } from "./memory_records";

function matches(event: AuditEvent, filter: ActivityFilter): boolean {
  const { accountId, postId, window, actor, kind } = filter;
  return (
    (accountId === undefined || event.accountId === accountId) &&
    (postId === undefined || event.postId === postId) &&
    (window === undefined || inWindow(window, event.at)) &&
    (actor === undefined || event.actor.startsWith(`${actor}:`)) &&
    (kind === undefined ||
      ACTIVITY_ACTIONS[kind].some((pattern) => actionMatches(event.action, pattern)))
  );
}

/** The activity page over the in-memory audit log and cost ledger, joined as D1 joins them. */
export class MemoryActivityLog implements ActivityLog {
  constructor(
    private readonly audit: MemoryAuditLog,
    private readonly costs: MemoryCostLedger,
  ) {}

  page(filter: ActivityFilter, offset: number, limit: number): Promise<ActivityPage> {
    const found = [...this.audit.events]
      .reverse()
      .filter((event) => matches(event, filter))
      .sort((a, b) => b.at - a.at);
    const entries = found
      .slice(offset, offset + limit)
      .map((event) => ({ ...event, cost: this.costOf(event) }));
    return Promise.resolve({ entries, total: found.length });
  }

  private costOf(event: AuditEvent): CostEstimate | null {
    const entry = this.costs.entries.find(
      (cost) =>
        cost.at === event.at &&
        cost.accountId === event.accountId &&
        `x.${cost.operation}` === event.action,
    );
    return entry?.estimate ?? null;
  }
}
