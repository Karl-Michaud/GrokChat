import type { Account, AccountStatus, Disclosure } from "../../entities/accounts/account";
import type { PostingPolicy } from "../../entities/accounts/posting_policy";
import type { Refusal } from "../access/refusal";

export type GetPolicyOutputData =
  | {
      readonly ok: true;
      readonly accountId: Account["id"];
      readonly handle: string;
      readonly status: AccountStatus;
      readonly disclosure: Disclosure;
      readonly policy: PostingPolicy;
    }
  | Refusal<"not_found" | "scope">;
