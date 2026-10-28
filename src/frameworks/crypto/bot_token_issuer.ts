import type { BotTokenIssuer, IssuedToken } from "../../use_cases/ports/bot_token_issuer";
import { randomToken } from "../web/base64url";
import { WebCryptoContentHasher } from "./sha256_hasher";

/** Bot tokens are 32 random bytes (plan §3.5), base64url: the format add-bot used to mint. */
export const BOT_TOKEN_BYTES = 32;

const hasher = new WebCryptoContentHasher();

/** The SHA-256 bot auth compares: lower-case hex over the token's UTF-8. */
export function tokenSha256(token: string): Promise<string> {
  return hasher.sha256Hex(new TextEncoder().encode(token));
}

/** The production issuer: WebCrypto randomness and SHA-256. */
export class WebCryptoBotTokenIssuer implements BotTokenIssuer {
  async issue(): Promise<IssuedToken> {
    const token = randomToken(BOT_TOKEN_BYTES);
    return { token, sha256: await tokenSha256(token) };
  }
}
