import { actorLabel, type Actor } from "../../entities/identity/actor";
import type { AccountId, PostId } from "../../entities/identity/ids";
import { redactCredentials } from "../../entities/security/redact";
import type { AuditLog } from "../ports/audit_log";
import type { Clock } from "../ports/clock";

export interface AuditedAction {
  readonly actor: Actor;
  readonly action: string;
  readonly accountId: AccountId | null;
  readonly postId: PostId | null;
}

/** Writes what an actor did, or was refused, to the audit log (I2: refusals are audited). */
export class ActionAudit {
  constructor(
    private readonly log: AuditLog,
    private readonly clock: Clock,
  ) {}

  done(action: AuditedAction, detail = ""): Promise<void> {
    return this.write(action, action.action, detail);
  }

  refused(action: AuditedAction, code: string): Promise<void> {
    return this.write(action, `refused.${action.action}`, code);
  }

  private write(action: AuditedAction, name: string, detail: string): Promise<void> {
    return this.log.append({
      at: this.clock.now(),
      actor: actorLabel(action.actor),
      action: name,
      accountId: action.accountId,
      postId: action.postId,
      detail: redactCredentials(detail),
    });
  }
}
