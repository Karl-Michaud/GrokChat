import type { AccountId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type { TokenSet } from "../../entities/x/token_set";

export interface StoredTokens {
  readonly tokens: TokenSet;
  /** Set before a refresh request leaves; still set on entry means it was interrupted (A2). */
  readonly refreshingSince: Instant | null;
}

/** The account's encrypted token set in its Durable Object's storage. */
export interface TokenStore {
  load(account: AccountId): Promise<StoredTokens | null>;
  markRefreshing(account: AccountId, at: Instant): Promise<void>;
  /** One atomic put: clears the marker and stores the rotated tokens. */
  commitRotated(account: AccountId, tokens: TokenSet): Promise<void>;
  clearMarker(account: AccountId): Promise<void>;
}
