/** A new bot token and its SHA-256: the token goes to the owner once, only the hash is kept. */
export interface IssuedToken {
  /** 32 random bytes, base64url (43 characters). */
  readonly token: string;
  /** Lower-case hex SHA-256 of the token's UTF-8, as bot auth computes it. */
  readonly sha256: string;
}

/** Mints bot tokens (WebCrypto in the driver; the inner layers have no randomness). */
export interface BotTokenIssuer {
  issue(): Promise<IssuedToken>;
}
