import type { Account } from "../../entities/accounts/account";
import type { ListAccountsOutputData } from "../../use_cases/list_accounts/output_data";
import { ADMIN } from "./admin_actor";
import { runUseCase } from "./presenter";
import type { AccountDirectory } from "./use_cases";

/** How an account is shown everywhere: its handle, its initials and its colour slot. */
export interface AccountBadge {
  readonly id: string;
  /** `@handle` */
  readonly handle: string;
  readonly initials: string;
  /**
   * 1 to 8, from the account's place in the id-ordered list, so it keeps its colour on every
   * page and under every filter (dataviz: colour follows the entity). Always shown beside the
   * handle, never alone.
   */
  readonly tone: number;
}

export interface AccountOption extends AccountBadge {
  readonly selected: boolean;
}

/** The accounts, by id, for names and filters on every page; none when the listing is refused. */
export function loadAccounts(useCases: AccountDirectory): Promise<readonly Account[]> {
  return runUseCase(useCases.listAccounts, { actor: ADMIN }, (output: ListAccountsOutputData) =>
    output.ok ? output.accounts : [],
  );
}

export const TONES = 8;

/**
 * Two letters for the avatar: the first of each of the handle's first two words (`musechat_daily`
 * → MD, `museChat` → MC), else its first two letters.
 */
export function initialsOf(handle: string): string {
  const words = handle.split(/[_.\-\d]|(?=[A-Z])/).filter((word) => word.length > 0);
  const [first = "", second = ""] = words;
  const letters = second === "" ? first.slice(0, 2) : `${first.charAt(0)}${second.charAt(0)}`;
  return (letters === "" ? handle.slice(0, 2) : letters).toUpperCase();
}

function badge(account: Account, index: number): AccountBadge {
  return {
    id: account.id,
    handle: `@${account.handle}`,
    initials: initialsOf(account.handle),
    tone: (index % TONES) + 1,
  };
}

/** The account's badge; an unknown id shows as itself, in the neutral tone 0. */
export function badgeOf(accounts: readonly Account[], id: string): AccountBadge {
  const index = accounts.findIndex((account) => account.id === id);
  const account = accounts[index];
  return account === undefined
    ? { id, handle: id, initials: id.slice(0, 2).toUpperCase(), tone: 0 }
    : badge(account, index);
}

/** The handle without its `@`, for links to X; null for an unknown account. */
export function bareHandle(accounts: readonly Account[], id: string): string | null {
  return accounts.find((account) => account.id === id)?.handle ?? null;
}

export function accountOptions(
  accounts: readonly Account[],
  selected: string | null,
): readonly AccountOption[] {
  return accounts.map((account, index) => ({
    ...badge(account, index),
    selected: account.id === selected,
  }));
}
