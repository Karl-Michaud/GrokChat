import type { Account } from "../../entities/accounts/account";
import type { Refusal } from "../access/refusal";

/** Every account, for the dashboard's accounts page (an account holds no token). */
export type ListAccountsOutputData =
  { readonly ok: true; readonly accounts: readonly Account[] } | Refusal<"human_only">;
