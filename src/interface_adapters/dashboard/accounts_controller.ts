import type { Account, AccountStatus } from "../../entities/accounts/account";
import type { Personality } from "../../entities/content/personality";
import { accountId } from "../../entities/identity/ids";
import type { AccountCommandResult } from "../../use_cases/admin/account_command";
import type { ListPersonalitiesOutputData } from "../../use_cases/list_personalities/output_data";
import { loadAccounts } from "./account_directory";
import { ADMIN } from "./admin_actor";
import { filled } from "./form_values";
import { invalid, page, redirect, refused, type Outcome } from "./outcome";
import { parsePolicyForm, policyForm, type PolicyForm } from "./policy_form";
import { runUseCase } from "./presenter";
import type { AccountUseCases } from "./use_cases";

export interface AccountRowView {
  readonly id: string;
  readonly handle: string;
  readonly status: AccountStatus;
  /** Refresh lost (A2) or revoked: shown first, cleared only by reconnecting. */
  readonly needsReconnect: boolean;
  readonly personality: string;
  readonly bioConfirmed: boolean;
  readonly automatedLabelConfirmed: boolean;
  readonly canActivate: boolean;
  readonly canPause: boolean;
  readonly policy: PolicyForm;
}

export interface PersonalityOption {
  readonly id: string;
  readonly name: string;
}

export interface AccountsView {
  readonly accounts: readonly AccountRowView[];
  readonly personalities: readonly PersonalityOption[];
  readonly notice: string | null;
}

export const ACCOUNTS_PAGE = "/dashboard/accounts";

/** The kill switch sets only these; reconnecting clears the others. */
const SWITCHABLE = ["ACTIVE", "PAUSED"] as const;

function accountRow(account: Account, personalities: readonly Personality[]): AccountRowView {
  const personality = personalities.find((candidate) => candidate.id === account.personalityId);
  return {
    id: account.id,
    handle: `@${account.handle}`,
    status: account.status,
    needsReconnect: account.status === "NEEDS_RECONNECT" || account.status === "DISCONNECTED",
    personality: personality?.name ?? account.personalityId,
    bioConfirmed: account.disclosure.bioConfirmed,
    automatedLabelConfirmed: account.disclosure.automatedLabelConfirmed,
    canActivate: account.status === "PAUSED",
    canPause: account.status === "ACTIVE",
    policy: policyForm(account.policy),
  };
}

const toOutcome = (output: AccountCommandResult<string>): Outcome<never> =>
  output.ok ? redirect(ACCOUNTS_PAGE) : refused(output.code);

/** The accounts page: status, kill switch, disclosure, policy (plan §3.4). */
export class AccountsController {
  constructor(private readonly useCases: AccountUseCases) {}

  async accounts(query: { readonly connected: string | null }): Promise<Outcome<AccountsView>> {
    const accounts = await loadAccounts(this.useCases);
    const personalities = await runUseCase(
      this.useCases.listPersonalities,
      { actor: ADMIN },
      (output: ListPersonalitiesOutputData) => (output.ok ? output.personalities : []),
    );
    const connected = filled(query.connected);
    return page({
      accounts: accounts.map((account) => accountRow(account, personalities)),
      personalities: personalities.map((item) => ({ id: item.id, name: item.name })),
      notice: connected === null ? null : `Connected ${connected}. It starts paused.`,
    });
  }

  status(id: string, value: string): Promise<Outcome<never>> {
    const status = SWITCHABLE.find((candidate) => candidate === value);
    if (status === undefined) {
      return Promise.resolve(invalid("The status must be ACTIVE or PAUSED."));
    }
    const input = { actor: ADMIN, accountId: accountId(id), status };
    return runUseCase(this.useCases.setAccountStatus, input, toOutcome);
  }

  disclosure(
    id: string,
    form: { readonly bioConfirmed: boolean; readonly automatedLabelConfirmed: boolean },
  ): Promise<Outcome<never>> {
    const input = { actor: ADMIN, accountId: accountId(id), ...form };
    return runUseCase(this.useCases.confirmDisclosure, input, toOutcome);
  }

  policy(id: string, form: PolicyForm): Promise<Outcome<never>> {
    const policy = parsePolicyForm(form);
    if ("message" in policy) {
      return Promise.resolve(invalid(policy.message));
    }
    const input = { actor: ADMIN, accountId: accountId(id), policy };
    return runUseCase(this.useCases.setPolicy, input, toOutcome);
  }
}
