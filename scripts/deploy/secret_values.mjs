// The Worker's secrets, built in exactly the formats it parses (plan §3.5, §3.6). WebCrypto only,
// so the same module runs under Node (the scripts) and in workerd, where
// tests/integration/deploy_secret_formats.test.ts checks every value against the Worker's parsers.

/** src/frameworks/web/password.ts: PBKDF2-SHA-256 at exactly 100,000 iterations, 256 bits. */
export const PBKDF2_ITERATIONS = 100_000;
export const MIN_PASSWORD_LENGTH = 12;
export const SALT_BYTES = 16;
/** src/frameworks/crypto/token_vault.ts: AES-256 keys. */
export const TOKEN_KEY_BYTES = 32;
/** src/frameworks/web/config.ts wants at least 32 characters; 32 bytes give 43. */
export const SESSION_SECRET_BYTES = 32;
/** src/frameworks/mcp/bot_auth.ts: tokens of at least 32 random bytes (43 base64url characters). */
export const BOT_TOKEN_BYTES = 32;

/** @param {number} count */
export function randomBytes(count) {
  return crypto.getRandomValues(new Uint8Array(count));
}

/** @param {Uint8Array} bytes */
function binary(bytes) {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

/** @param {Uint8Array} bytes RFC 4648 §5 without padding. */
export function base64Url(bytes) {
  return btoa(binary(bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {Uint8Array} bytes */
function base64(bytes) {
  return btoa(binary(bytes));
}

/**
 * Why the two entries cannot be the admin password, or null.
 * @param {string} password
 * @param {string} confirmation
 * @returns {string | null}
 */
export function passwordProblem(password, confirmation) {
  if (password !== confirmation) {
    return "the two entries differ";
  }
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return `the password is shorter than ${String(MIN_PASSWORD_LENGTH)} characters`;
  }
  return null;
}

/**
 * `pbkdf2-sha256$100000$<salt>$<hash>`, both base64url: GROKCHAT_ADMIN_PASSWORD_HASH.
 * @param {string} password
 * @param {Uint8Array} [salt] 16 random bytes unless given (tests only).
 * @returns {Promise<string>}
 */
export async function adminPasswordHash(password, salt = randomBytes(SALT_BYTES)) {
  if (salt.length < SALT_BYTES) {
    throw new Error(`the salt must be at least ${String(SALT_BYTES)} bytes`);
  }
  const encoded = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey("raw", encoded, "PBKDF2", false, ["deriveBits"]);
  const params = { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS };
  const bits = new Uint8Array(await crypto.subtle.deriveBits(params, key, 256));
  return ["pbkdf2-sha256", String(PBKDF2_ITERATIONS), base64Url(salt), base64Url(bits)].join("$");
}

/** One new AES-256 key, standard base64: one entry of GROKCHAT_TOKEN_KEYS. */
export function newTokenKey() {
  return base64(randomBytes(TOKEN_KEY_BYTES));
}

/**
 * The keys of a GROKCHAT_TOKEN_KEYS value, newest first. Errors name the key by position only.
 * @param {string} secret
 * @returns {string[]}
 */
export function parseTokenKeys(secret) {
  const keys = secret
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (keys.length === 0) {
    throw new Error("the token keys hold no key");
  }
  keys.forEach((key, index) => {
    const decoded = /^[A-Za-z0-9+/]+={0,2}$/.test(key) ? atob(key) : "";
    if (decoded.length !== TOKEN_KEY_BYTES) {
      throw new Error(`token key ${String(index + 1)} is not 32 bytes of base64`);
    }
  });
  if (new Set(keys).size !== keys.length) {
    throw new Error("the token keys list a key twice");
  }
  return keys;
}

/**
 * Rotation (token_vault.ts): a new key in front; the Worker re-seals each token under it when the
 * token is next loaded, and the older keys still open what they sealed.
 * @param {string} current
 */
export function rotatedTokenKeys(current) {
  return [newTokenKey(), ...parseTokenKeys(current)].join(",");
}

/**
 * Only the newest key: run once every account's token was re-sealed under it.
 * @param {string} current
 */
export function newestTokenKeyOnly(current) {
  const [newest = ""] = parseTokenKeys(current);
  return newest;
}

/** GROKCHAT_SESSION_SECRET: 32 random bytes, base64url (43 characters). */
export function newSessionSecret() {
  return base64Url(randomBytes(SESSION_SECRET_BYTES));
}

/** A bot's bearer token: 32 random bytes, base64url (43 characters). */
export function newBotToken() {
  return base64Url(randomBytes(BOT_TOKEN_BYTES));
}

/**
 * Lower-case hex SHA-256 of the token's UTF-8: what bot_auth.ts compares.
 * @param {string} text
 */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
