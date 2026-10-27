import type { AccountId, PostId } from "../../entities/identity/ids";
import type { AuditEvent } from "../../entities/records/audit_event";
import type { TimeWindow } from "../../entities/time/instant";

export interface AuditFilter {
  readonly accountId?: AccountId;
  readonly postId?: PostId;
  readonly window?: TimeWindow;
  readonly limit?: number;
}

export interface AuditLog {
  append(event: AuditEvent): Promise<void>;
  /** Newest first. */
  list(filter: AuditFilter): Promise<readonly AuditEvent[]>;
}
