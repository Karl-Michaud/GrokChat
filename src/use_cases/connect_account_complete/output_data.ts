import type { AccountStatus } from "../../entities/accounts/account";
import type { AccountId } from "../../entities/identity/ids";
import type { Refusal } from "../access/refusal";

export type ConnectAccountCompleteRefusalCode =
  | "human_only"
  | "oauth_state"
  | "oauth_failed"
  | "not_found"
  | "different_x_user"
  | "already_connected"
  | "personality_required"
  | "personality_not_found";

/** Never carries a token. */
export type ConnectAccountCompleteOutputData =
  | {
      readonly ok: true;
      readonly accountId: AccountId;
      readonly handle: string;
      readonly status: AccountStatus;
    }
  | Refusal<ConnectAccountCompleteRefusalCode>;
