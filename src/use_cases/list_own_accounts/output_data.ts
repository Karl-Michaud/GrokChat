import type { Account } from "../../entities/accounts/account";
/** The accounts the actor may act on, by id: a bot's scope, or every account for a human. */
export interface ListOwnAccountsOutputData {
  readonly ok: true;
  readonly accounts: readonly Account[];
}
