import type { Account } from "../../entities/accounts/account";
import type { ListAccountsOutputData } from "../../use_cases/list_accounts/output_data";
import { ADMIN } from "./admin_actor";
import { runUseCase } from "./presenter";
import type { AccountDirectory } from "./use_cases";

export interface AccountOption {
  readonly id: string;
  readonly handle: string;
  readonly selected: boolean;
}

/** The accounts, for names and filters on every page; none when the listing is refused. */
export function loadAccounts(useCases: AccountDirectory): Promise<readonly Account[]> {
  return runUseCase(useCases.listAccounts, { actor: ADMIN }, (output: ListAccountsOutputData) =>
    output.ok ? output.accounts : [],
  );
}

/** `@handle` for an account id, or the id itself when the account is unknown. */
export function handleOf(accounts: readonly Account[], id: string): string {
  const account = accounts.find((candidate) => candidate.id === id);
  return account === undefined ? id : `@${account.handle}`;
}

export function accountOptions(
  accounts: readonly Account[],
  selected: string | null,
): readonly AccountOption[] {
  return accounts.map((account) => ({
    id: account.id,
    handle: `@${account.handle}`,
    selected: account.id === selected,
  }));
}
