import type { Actor } from "../../entities/identity/actor";
import type { AuditFilter } from "../ports/audit_log";

export interface AuditListInputData {
  readonly actor: Actor;
  readonly filter: AuditFilter;
}
