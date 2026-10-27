import type { XUserId } from "../../entities/identity/ids";
import type { TokenSet } from "../../entities/x/token_set";

export interface ConnectedXUser {
  readonly xUserId: XUserId;
  readonly handle: string;
  readonly tokens: TokenSet;
}

/** X's OAuth 2.0 authorization-code flow with PKCE S256 (U1). */
export interface XAccountConnector {
  authorizeUrl(state: string, codeChallenge: string): string;
  complete(code: string, verifier: string): Promise<ConnectedXUser | null>;
}
