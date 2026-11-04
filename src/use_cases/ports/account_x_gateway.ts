import type { AccountId, XPostId } from "../../entities/identity/ids";
import type { TokenSet } from "../../entities/x/token_set";

export interface DeleteOutcome {
  readonly xPostId: XPostId;
  readonly deleted: boolean;
}

/**
 * The account-addressed X calls the Worker needs, run inside the account's Durable Object, so
 * tokens never leave it (A1).
 */
export interface AccountXGateway {
  /** Deletes in the order given (last part first) and stops at the first failure. */
  deletePost(account: AccountId, xPostIds: readonly XPostId[]): Promise<readonly DeleteOutcome[]>;
  storeConnectedTokens(account: AccountId, tokens: TokenSet): Promise<void>;
}
