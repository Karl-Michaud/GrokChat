import { HOUR } from "../../entities/time/instant";
import { randomToken } from "./base64url";
import type { CookieSigner } from "./signed_cookie";

/** `__Host-`: the browser keeps it only with Secure, Path=/ and no Domain (no subdomain can set it). */
export const SESSION_COOKIE = "__Host-grokchat_session";
export const SESSION_TTL = 12 * HOUR;

export interface Session {
  /** What OAuth state is bound to (rev 4 M7). */
  readonly id: string;
  /** The per-session CSRF token every non-GET form carries (m4). */
  readonly csrf: string;
  readonly expiresAt: number;
}

export async function issueSession(
  signer: CookieSigner,
  now: number,
): Promise<{ readonly session: Session; readonly cookie: string }> {
  const session = { id: randomToken(16), csrf: randomToken(32), expiresAt: now + SESSION_TTL };
  const cookie = await signer.sign("session", session.expiresAt, {
    id: session.id,
    csrf: session.csrf,
  });
  return { session, cookie };
}

export async function readSession(
  signer: CookieSigner,
  cookie: string | undefined,
  now: number,
): Promise<Session | null> {
  if (cookie === undefined) {
    return null;
  }
  const payload = await signer.verify("session", cookie, now);
  const { id, csrf, expiresAt } = payload ?? {};
  return typeof id === "string" && typeof csrf === "string" && typeof expiresAt === "number"
    ? { id, csrf, expiresAt }
    : null;
}
