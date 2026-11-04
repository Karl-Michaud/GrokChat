import type { PasswordVerifier } from "../../use_cases/ports/password_verifier";
import { fromBase64Url, toBase64Url } from "./base64url";

/**
 * PBKDF2-SHA-256 at 100,000 iterations, the most Workers supports (U19; ~33 ms CPU per login,
 * behind the throttle). Below OWASP's 600,000 for SHA-256: an accepted constraint (plan §3.5).
 */
export const PBKDF2_ITERATIONS = 100_000;
const SCHEME = "pbkdf2-sha256";
const HASH_BITS = 256;

interface StoredHash {
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
}

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** `pbkdf2-sha256$100000$<salt>$<hash>`, both base64url: the GROKCHAT_ADMIN_PASSWORD_HASH secret. */
export async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const hash = await derive(password, salt);
  return [SCHEME, String(PBKDF2_ITERATIONS), toBase64Url(salt), toBase64Url(hash)].join("$");
}

/** The stored hash, or null when it is not this scheme at exactly 100,000 iterations. */
export function parsePasswordHash(encoded: string): StoredHash | null {
  const [scheme, iterations, salt, hash, extra] = encoded.split("$");
  const saltBytes = fromBase64Url(salt ?? "");
  const hashBytes = fromBase64Url(hash ?? "");
  const valid =
    scheme === SCHEME &&
    iterations === String(PBKDF2_ITERATIONS) &&
    extra === undefined &&
    saltBytes !== null &&
    saltBytes.length >= 16 &&
    hashBytes?.length === HASH_BITS / 8;
  return valid ? { salt: saltBytes, hash: hashBytes } : null;
}

export class Pbkdf2PasswordVerifier implements PasswordVerifier {
  constructor(private readonly stored: StoredHash) {}

  async verify(password: string): Promise<boolean> {
    const derived = await derive(password, this.stored.salt);
    return crypto.subtle.timingSafeEqual(derived, this.stored.hash);
  }
}
