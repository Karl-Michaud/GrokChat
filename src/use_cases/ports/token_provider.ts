import type { AccountId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";

export type AccessTokenResult =
  | { readonly kind: "token"; readonly accessToken: string }
  /** The token is lost or was revoked: the account must be reconnected (A2). */
  | { readonly kind: "needs_reconnect" }
  /** A refresh was needed but its worst case does not fit before the deadline (N1). */
  | { readonly kind: "refresh_does_not_fit" }
  /** The refresh request never left (a connect error): nothing was rotated, try later. */
  | { readonly kind: "unavailable" };

export interface TokenProvider {
  accessToken(account: AccountId, deadline: Instant): Promise<AccessTokenResult>;
}
