import type { AuditEvent } from "../../entities/records/audit_event";
import type { Refusal } from "../access/refusal";

export type AuditListOutputData =
  { readonly ok: true; readonly events: readonly AuditEvent[] } | Refusal<"human_only">;
