import type { ActivityKind, ActorKind } from "../../entities/analytics/activity_kind";
import type { CostEstimate } from "../../entities/costs/estimate_cost";
import type { AccountId, PostId } from "../../entities/identity/ids";
import type { AuditEvent } from "../../entities/records/audit_event";
import type { TimeWindow } from "../../entities/time/instant";

/** Every field narrows the history; an empty filter is the whole audit log. */
export interface ActivityFilter {
  readonly accountId?: AccountId;
  readonly postId?: PostId;
  readonly actor?: ActorKind;
  readonly kind?: ActivityKind;
  readonly window?: TimeWindow;
}

/** An audit event with what its X call was estimated to cost; null for an event with none. */
export interface ActivityEntry extends AuditEvent {
  readonly cost: CostEstimate | null;
}

export interface ActivityPage {
  readonly entries: readonly ActivityEntry[];
  /** How many events match the filter in all. */
  readonly total: number;
}

/** The dashboard's history of requests (GROKCHAT-15): the audit log, joined to its costs. */
export interface ActivityLog {
  /** Newest first (by time; the later write first in a tie), `limit` entries after `offset`. */
  page(filter: ActivityFilter, offset: number, limit: number): Promise<ActivityPage>;
}
