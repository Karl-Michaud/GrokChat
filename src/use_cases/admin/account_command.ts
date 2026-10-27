import type { Account } from "../../entities/accounts/account";
import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import { refusal, type Refusal } from "../access/refusal";
import type { AccountRepository } from "../ports/account_repository";

export type AccountCommandResult<Extra extends string = never> =
  { readonly ok: true; readonly account: Account } | Refusal<"not_found" | "human_only" | Extra>;

export interface AccountChange<Extra extends string> {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly action: string;
  readonly change: (account: Account) => Account | Refusal<Extra>;
}

/** Load, human-only, change, save, audit: every dashboard change to an account. */
export class AccountCommand {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly guard: AccessGuard,
    private readonly audit: ActionAudit,
  ) {}

  async run<Extra extends string = never>(
    command: AccountChange<Extra>,
  ): Promise<AccountCommandResult<Extra>> {
    const account = await this.accounts.get(command.accountId);
    if (account === null) {
      return refusal("not_found");
    }
    const action = {
      actor: command.actor,
      action: command.action,
      accountId: account.id,
      postId: null,
    };
    if (!(await this.guard.humanOnly(action))) {
      return refusal("human_only");
    }
    const changed = command.change(account);
    if ("ok" in changed) {
      return changed;
    }
    await this.accounts.save(changed);
    await this.audit.done(action);
    return { ok: true, account: changed };
  }
}
