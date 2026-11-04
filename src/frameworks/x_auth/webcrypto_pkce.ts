import type { PkceGenerator, PkcePair } from "../../use_cases/ports/pkce_generator";

/** RFC 7636: 32 random bytes give a 43-character verifier (the minimum is 43, the maximum 128). */
export const VERIFIER_BYTES = 32;

/** base64url without padding (RFC 7636 appendix A). */
export function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** The S256 challenge of a verifier: base64url(SHA-256(ASCII(verifier))). */
export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** A random PKCE verifier and its S256 challenge, by WebCrypto. */
export class WebCryptoPkce implements PkceGenerator {
  async create(): Promise<PkcePair> {
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
    return { verifier, challenge: await s256(verifier) };
  }
}
