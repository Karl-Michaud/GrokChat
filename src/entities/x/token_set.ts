import type { Instant } from "../time/instant";

/** An account's OAuth 2.0 tokens. They live only in the account's Durable Object (A1). */
export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: Instant;
}
