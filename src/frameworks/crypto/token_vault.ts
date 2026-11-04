import { base64UrlFromBytes, bytesFromBase64, hexFromBytes } from "./base64";

/** AES-256-GCM keys are 32 bytes; the GCM nonce is 12 random bytes per seal. */
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

interface VaultKey {
  readonly id: string;
  readonly key: CryptoKey;
}

interface KeyRing {
  readonly newest: VaultKey;
  readonly all: readonly VaultKey[];
}

export interface Opened {
  readonly plaintext: string;
  /** False when it was sealed under an older key: the caller re-seals it (rotation). */
  readonly current: boolean;
}

/** Errors never carry key material or plaintext. */
export class TokenVaultError extends Error {
  override readonly name = "TokenVaultError";
}

function parseSecret(secret: string): readonly [Uint8Array, ...Uint8Array[]] {
  const parts = secret
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new TokenVaultError("GROKCHAT_TOKEN_KEYS holds no key");
  }
  const [first, ...rest] = parts.map((part, index) => {
    let raw: Uint8Array;
    try {
      raw = bytesFromBase64(part);
    } catch {
      throw new TokenVaultError(`GROKCHAT_TOKEN_KEYS key ${String(index + 1)} is not base64`);
    }
    if (raw.length !== KEY_BYTES) {
      throw new TokenVaultError(`GROKCHAT_TOKEN_KEYS key ${String(index + 1)} is not 32 bytes`);
    }
    return raw;
  });
  // parts is not empty, so neither is the map of it.
  return [first ?? new Uint8Array(), ...rest];
}

/** A key's id: the first 8 bytes of its SHA-256, so adding a key never renumbers the others. */
async function importKey(raw: Uint8Array): Promise<VaultKey> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { id: hexFromBytes(digest.slice(0, 8)), key };
}

/**
 * The token vault (plan §3.5): AES-256-GCM under keys from the secret `GROKCHAT_TOKEN_KEYS`
 * (comma-separated base64, newest first). A sealed value is `v1.<key id>.<iv>.<ciphertext>` and
 * is bound to its account by the additional data, so a value moved to another account fails to
 * open. Opening tries the key the value names; sealing always uses the newest (MultiFernet-style
 * rotation: add a key in front, let values re-seal, then drop the old key).
 */
export class TokenVault {
  private constructor(private readonly keys: Promise<KeyRing>) {}

  static fromSecret(secret: string): TokenVault {
    const raw = parseSecret(secret);
    const ids = new Set(raw.map((key) => key.join(",")));
    if (ids.size !== raw.length) {
      throw new TokenVaultError("GROKCHAT_TOKEN_KEYS lists a key twice");
    }
    const [newest, ...older] = raw;
    const ring = Promise.all([importKey(newest), ...older.map(importKey)]).then(
      ([first, ...rest]) => ({ newest: first, all: [first, ...rest] }),
    );
    return new TokenVault(ring);
  }

  async seal(plaintext: string, additionalData: string): Promise<string> {
    const { id, key } = (await this.keys).newest;
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const params = {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(additionalData),
    };
    const sealed = await crypto.subtle.encrypt(params, key, new TextEncoder().encode(plaintext));
    return [VERSION, id, base64UrlFromBytes(iv), base64UrlFromBytes(new Uint8Array(sealed))].join(
      ".",
    );
  }

  async open(sealed: string, additionalData: string): Promise<Opened> {
    const [version, id, iv, body] = sealed.split(".");
    if (version !== VERSION || id === undefined || iv === undefined || body === undefined) {
      throw new TokenVaultError("not a sealed token value");
    }
    const keys = (await this.keys).all;
    const index = keys.findIndex((candidate) => candidate.id === id);
    const match = keys[index];
    if (match === undefined) {
      throw new TokenVaultError("sealed under a key GROKCHAT_TOKEN_KEYS no longer holds");
    }
    const params = {
      name: "AES-GCM",
      iv: bytesFromBase64(iv),
      additionalData: new TextEncoder().encode(additionalData),
    };
    try {
      const plain = await crypto.subtle.decrypt(params, match.key, bytesFromBase64(body));
      return { plaintext: new TextDecoder().decode(plain), current: index === 0 };
    } catch {
      throw new TokenVaultError("sealed token value failed authentication");
    }
  }
}
