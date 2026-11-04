import type { PostingPolicy } from "../../entities/accounts/posting_policy";
import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

export interface SetPolicyInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly policy: PostingPolicy;
}
