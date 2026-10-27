import type { PasswordVerifier } from "../../use_cases/ports/password_verifier";
import type { Env } from "../env";
import { parsePasswordHash, Pbkdf2PasswordVerifier } from "./password";
import { CookieSigner } from "./signed_cookie";

/** What the dashboard reads from the Worker's secrets and vars (plan §3.6). */
export interface WebConfig {
  readonly signer: CookieSigner;
  readonly verifier: PasswordVerifier;
  /** `GROKCHAT_PUBLIC_ORIGIN`: every non-GET request's Origin must equal it exactly (m4). */
  readonly origin: string;
}

/** The session secret signs every cookie: at least 32 characters (`openssl rand -base64 32`). */
export const MIN_SESSION_SECRET = 32;

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/** An origin written exactly as browsers send it: https, or http on localhost for `wrangler dev`. */
export function validOrigin(origin: string): boolean {
  if (!URL.canParse(origin)) {
    return false;
  }
  const url = new URL(origin);
  const secure = url.protocol === "https:" || LOCAL_HOSTS.includes(url.hostname);
  return secure && url.origin === origin;
}

const parsed = new WeakMap<Env, WebConfig | null>();

function parse(env: Env): WebConfig | null {
  const secret = env.GROKCHAT_SESSION_SECRET ?? "";
  const stored = parsePasswordHash(env.GROKCHAT_ADMIN_PASSWORD_HASH ?? "");
  const origin = env.GROKCHAT_PUBLIC_ORIGIN ?? "";
  if (secret.length < MIN_SESSION_SECRET || stored === null || !validOrigin(origin)) {
    return null;
  }
  return { signer: new CookieSigner(secret), verifier: new Pbkdf2PasswordVerifier(stored), origin };
}

/** Null while any of the three is missing or malformed: the dashboard then answers 503. */
export function webConfig(env: Env): WebConfig | null {
  if (!parsed.has(env)) {
    parsed.set(env, parse(env));
  }
  return parsed.get(env) ?? null;
}
