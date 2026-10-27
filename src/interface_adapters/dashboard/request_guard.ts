/**
 * Equal strings, compared in a time that depends only on the trusted string's length (the CSRF
 * token compare). `trusted` is the session's token, ASCII by construction.
 */
export function constantTimeEqual(sent: string, trusted: string): boolean {
  if (sent.length !== trusted.length) {
    return false;
  }
  const difference = Array.from(
    { length: trusted.length },
    (_, index) => trusted.charCodeAt(index) ^ sent.charCodeAt(index),
  ).reduce((bits, bit) => bits | bit, 0);
  return difference === 0;
}

export interface UnsafeRequest {
  /** The request's `Origin` header; null when absent. */
  readonly origin: string | null;
  /** `GROKCHAT_PUBLIC_ORIGIN`. */
  readonly expectedOrigin: string;
  /** The token the form or header sent; null when absent. */
  readonly sentToken: string | null;
  /** The session's token; null for a route with no session yet (the login form). */
  readonly sessionToken: string | null;
}

export type UnsafeVerdict = "ok" | "origin" | "csrf";

/**
 * Every non-GET dashboard and OAuth route (plan §3.5, m4): every Worker on the same workers.dev
 * subdomain is same-site, so SameSite is not the fence. The Origin must match exactly, and when a
 * session exists the request must carry its CSRF token.
 */
export function checkUnsafeRequest(request: UnsafeRequest): UnsafeVerdict {
  if (request.origin !== request.expectedOrigin) {
    return "origin";
  }
  if (request.sessionToken === null) {
    return "ok";
  }
  const sent = request.sentToken;
  return sent !== null && constantTimeEqual(sent, request.sessionToken) ? "ok" : "csrf";
}
