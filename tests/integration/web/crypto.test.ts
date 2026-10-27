import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { fromBase64Url, randomToken, toBase64Url } from "../../../src/frameworks/web/base64url";
import { validOrigin, webConfig } from "../../../src/frameworks/web/config";
import { SystemClock } from "../../../src/frameworks/durable_objects/system_clock";
import { RandomIds } from "../../../src/frameworks/runtime/random_ids";
import { WebCryptoPkce } from "../../../src/frameworks/x_auth/webcrypto_pkce";
import {
  hashPassword,
  parsePasswordHash,
  Pbkdf2PasswordVerifier,
  PBKDF2_ITERATIONS,
} from "../../../src/frameworks/web/password";
import { issueSession, readSession, SESSION_TTL } from "../../../src/frameworks/web/session";
import { CookieSigner } from "../../../src/frameworks/web/signed_cookie";
import { ORIGIN, PASSWORD, webEnv } from "./browser";

const SALT = new Uint8Array(16).fill(1);

describe("base64url", () => {
  it("round-trips bytes without padding and refuses other alphabets", () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255]);
    const text = toBase64Url(bytes);
    expect(text).toBe("APr7_P3-_w");
    expect(fromBase64Url(text)).toStrictEqual(bytes);
    expect(fromBase64Url("")).toStrictEqual(new Uint8Array());
    expect(fromBase64Url("a+b/")).toBeNull();
    expect(fromBase64Url("a")).toBeNull();
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).not.toBe(randomToken(16));
  });
});

describe("ids, clock and PKCE (WebCrypto)", () => {
  it("ids are random v4 UUIDs; the clock is the system's", () => {
    const ids = new RandomIds();
    expect(ids.newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(ids.newId()).not.toBe(ids.newId());
    const before = Date.now();
    expect(new SystemClock().now()).toBeGreaterThanOrEqual(before);
  });

  it("the challenge is the S256 of the verifier (RFC 7636 appendix B)", async () => {
    const pair = await new WebCryptoPkce().create();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pair.verifier));
    expect(pair.challenge).toBe(toBase64Url(new Uint8Array(digest)));
    expect((await new WebCryptoPkce().create()).verifier).not.toBe(pair.verifier);
  });
});

describe("the admin password (PBKDF2-SHA-256, 100,000 iterations, U19)", () => {
  it("hashes in the stored format and verifies only the right password", async () => {
    const encoded = await hashPassword(PASSWORD, SALT);
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    expect(encoded).toMatch(/^pbkdf2-sha256\$100000\$AQEBAQEBAQEBAQEBAQEBAQ\$[A-Za-z0-9_-]{43}$/);
    const stored = parsePasswordHash(encoded);
    if (stored === null) {
      throw new Error("expected a hash");
    }
    const verifier = new Pbkdf2PasswordVerifier(stored);
    expect(await verifier.verify(PASSWORD)).toBe(true);
    expect(await verifier.verify(`${PASSWORD} `)).toBe(false);
    expect(await verifier.verify("")).toBe(false);
  });

  it("refuses any other scheme, iteration count, short salt or wrong length", async () => {
    const encoded = await hashPassword(PASSWORD, SALT);
    const [, , salt = "", hash = ""] = encoded.split("$");
    const variants = [
      `pbkdf2-sha512$100000$${salt}$${hash}`,
      `pbkdf2-sha256$600000$${salt}$${hash}`,
      `pbkdf2-sha256$100000$${salt}$${hash}$x`,
      `pbkdf2-sha256$100000$AQEB$${hash}`,
      `pbkdf2-sha256$100000$${salt}$AQEB`,
      `pbkdf2-sha256$100000$${salt}$not+base64`,
      `pbkdf2-sha256$100000$${salt}`,
      "",
    ];
    for (const variant of variants) {
      expect(parsePasswordHash(variant)).toBeNull();
    }
    expect(parsePasswordHash(encoded)).not.toBeNull();
  });
});

describe("signed cookies (HMAC-SHA-256)", () => {
  const signer = new CookieSigner("a".repeat(32));
  const now = 1_000_000;

  it("returns the payload of a fresh value of the same purpose", async () => {
    const value = await signer.sign("session", now + 10, { id: "s" });
    expect(await signer.verify("session", value, now)).toStrictEqual({
      id: "s",
      purpose: "session",
      expiresAt: now + 10,
    });
  });

  it("refuses an expired, other-purpose, tampered, foreign or malformed value", async () => {
    const value = await signer.sign("session", now + 10, { id: "s" });
    const [body = "", signature = ""] = value.split(".");
    expect(await signer.verify("session", value, now + 10)).toBeNull();
    expect(await signer.verify("connect", value, now)).toBeNull();
    const forged = toBase64Url(
      new TextEncoder().encode('{"id":"t","purpose":"session","expiresAt":9e15}'),
    );
    expect(await signer.verify("session", `${forged}.${signature}`, now)).toBeNull();
    const other = await new CookieSigner("b".repeat(32)).sign("session", now + 10, { id: "s" });
    expect(await signer.verify("session", other, now)).toBeNull();
    for (const bad of ["", body, `${value}.x`, `${body}.!!`, `.${signature}`]) {
      expect(await signer.verify("session", bad, now)).toBeNull();
    }
  });

  it("refuses a validly signed value without a numeric expiry", async () => {
    const value = await signer.sign("session", Number.NaN, {});
    expect(await signer.verify("session", value, now)).toBeNull();
  });
});

describe("sessions (12 h)", () => {
  const signer = new CookieSigner("a".repeat(32));

  it("issues a session with fresh ids and reads it back until it expires", async () => {
    const { session, cookie } = await issueSession(signer, 1_000);
    expect(session.expiresAt).toBe(1_000 + SESSION_TTL);
    expect(SESSION_TTL).toBe(12 * 60 * 60 * 1000);
    expect(session.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(session.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await readSession(signer, cookie, 2_000)).toStrictEqual(session);
    expect(await readSession(signer, cookie, session.expiresAt)).toBeNull();
    expect(await readSession(signer, undefined, 2_000)).toBeNull();
    const other = await issueSession(signer, 1_000);
    expect(other.session.csrf).not.toBe(session.csrf);
  });

  it("refuses a signed value of the right purpose but the wrong shape", async () => {
    const value = await signer.sign("session", 10_000, { id: 1, csrf: "c" });
    expect(await readSession(signer, value, 0)).toBeNull();
    const noCsrf = await signer.sign("session", 10_000, { id: "i" });
    expect(await readSession(signer, noCsrf, 0)).toBeNull();
  });
});

describe("the dashboard's config", () => {
  it("accepts an exact https origin, or http on localhost", () => {
    expect(validOrigin("https://grokchat.example.workers.dev")).toBe(true);
    expect(validOrigin("http://localhost:8787")).toBe(true);
    expect(validOrigin("http://127.0.0.1:8787")).toBe(true);
    for (const bad of [
      "http://grokchat.example.workers.dev",
      "https://grokchat.example.workers.dev/",
      "https://grokchat.example.workers.dev/path",
      "HTTPS://grokchat.test",
      "grokchat.test",
      "",
    ]) {
      expect(validOrigin(bad)).toBe(false);
    }
  });

  it("is null until every value is set and valid, and parsed once per env", async () => {
    const good = await webEnv();
    const config = webConfig(good);
    expect(config?.origin).toBe(ORIGIN);
    expect(webConfig(good)).toBe(config);
    expect(webConfig(env)).toBeNull();
    expect(webConfig(await webEnv({ GROKCHAT_SESSION_SECRET: "x".repeat(31) }))).toBeNull();
    expect(webConfig(await webEnv({ GROKCHAT_SESSION_SECRET: "x".repeat(32) }))).not.toBeNull();
    expect(webConfig(await webEnv({ GROKCHAT_ADMIN_PASSWORD_HASH: "plain" }))).toBeNull();
    expect(webConfig(await webEnv({ GROKCHAT_PUBLIC_ORIGIN: `${ORIGIN}/` }))).toBeNull();
  });
});
