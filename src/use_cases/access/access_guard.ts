import { authorize } from "../../entities/identity/actor";
import type { ActionAudit, AuditedAction } from "./action_audit";

/**
 * Every interactor calls this after loading the resource (plan §3.3): a bot outside its scope, or
 * a non-human on a human-only action, is refused and the refusal is audited.
 */
export class AccessGuard {
  constructor(private readonly audit: ActionAudit) {}

  async inScope(
    action: AuditedAction & { readonly accountId: NonNullable<AuditedAction["accountId"]> },
  ): Promise<boolean> {
    if (authorize(action.actor, action.accountId).allowed) {
      return true;
    }
    await this.audit.refused(action, "scope");
    return false;
  }

  async humanOnly(action: AuditedAction): Promise<boolean> {
    if (action.actor.kind === "human") {
      return true;
    }
    await this.audit.refused(action, "human_only");
    return false;
  }
}
