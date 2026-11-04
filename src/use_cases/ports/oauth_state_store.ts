import type { Instant } from "../../entities/time/instant";

export interface OAuthState {
  readonly state: string;
  readonly verifier: string;
  readonly sessionId: string;
  readonly expiresAt: Instant;
}

/** PKCE state bound to the admin session, single-use (rev 4 M7). */
export interface OAuthStateStore {
  put(record: OAuthState): Promise<void>;
  /** The verifier, once: null when unknown, already taken, expired or from another session. */
  take(state: string, sessionId: string, now: Instant): Promise<string | null>;
}
