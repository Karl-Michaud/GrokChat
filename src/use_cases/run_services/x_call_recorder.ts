import { estimateCost, type XOperation } from "../../entities/costs/estimate_cost";
import type { AccountId, PostId } from "../../entities/identity/ids";
import type { AuditEvent } from "../../entities/records/audit_event";
import type { CostEntry } from "../../entities/records/cost_entry";
import { redactCredentials } from "../../entities/security/redact";
import type { Instant } from "../../entities/time/instant";
import type { AuditLog } from "../ports/audit_log";
import type { CostLedger } from "../ports/cost_ledger";

/** The account an X call was made for, as far as pricing needs it. */
export interface CallAccount {
  readonly id: AccountId;
  /** Only reads are priced by it; absent means an ordinary account. */
  readonly isAppOwner?: boolean;
}

export interface XCall {
  readonly account: CallAccount;
  readonly operation: XOperation;
  /** Whether X may have billed the call: a create X refused or never received costs nothing. */
  readonly billed: boolean;
  readonly outcome: string;
  readonly postId: PostId | null;
  readonly at: Instant;
}

/**
 * Builds the cost entry and the audit event every X call writes (I5). The create's pair goes into
 * `commitPart`'s batch; every other call's pair is appended here.
 */
export class XCallRecorder {
  constructor(
    private readonly audit: AuditLog,
    private readonly costs: CostLedger,
  ) {}

  entries(call: XCall): { readonly audit: AuditEvent; readonly cost: CostEntry } {
    const estimate = call.billed
      ? estimateCost(call.operation, call.account.isAppOwner === true)
      : ({ kind: "usd", micros: 0 } as const);
    return {
      audit: {
        at: call.at,
        actor: "system:x",
        action: `x.${call.operation.kind}`,
        accountId: call.account.id,
        postId: call.postId,
        detail: redactCredentials(call.outcome),
      },
      cost: { at: call.at, accountId: call.account.id, operation: call.operation.kind, estimate },
    };
  }

  async record(call: XCall): Promise<void> {
    const { audit, cost } = this.entries(call);
    await this.audit.append(audit);
    await this.costs.append(cost);
  }
}
