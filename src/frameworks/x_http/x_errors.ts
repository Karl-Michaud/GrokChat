import { redactCredentials } from "../../entities/security/redact";
import { SECOND, type Instant } from "../../entities/time/instant";
import type { RateScope, XFailure } from "../../entities/x/x_failure";
import { field, text } from "./json_fields";

/** An error detail is cut to this many characters before it reaches the audit log. */
export const DETAIL_LIMIT = 300;

/**
 * X's problem `type`s and `reason`s that mean the credentials, not the content, were refused
 * (docs.x.com: unsupported-authentication, client-forbidden / client-not-enrolled).
 */
const AUTH_PROBLEM =
  /unsupported-authentication|client-forbidden|not-enrolled|oauth|unauthori[sz]ed/i;

/**
 * A 403 refused for the post's content: X's `about:blank` "Forbidden" problems say so in their
 * detail (duplicate content, "not allowed to create", "not permitted to perform this action", and
 * a reply X does not allow: "Reply to this conversation is not allowed because you have not been
 * mentioned or otherwise engaged by the author").
 */
const CONTENT_DETAIL =
  /duplicate content|not allowed to (create|post)|not permitted to perform|reply to this conversation is not allowed/i;

/** The human-readable part of an X error body: a problem's title and detail, or `errors[0]`. */
export function errorDetail(body: unknown): string {
  const title = text(field(body, "title"));
  const detail = text(field(body, "detail")) ?? text(field(body, "error_description"));
  const first = field(field(body, "errors"), 0);
  const parts = [title, detail ?? text(field(first, "message")) ?? text(field(first, "detail"))];
  const joined = parts.filter((part): part is string => part !== null).join(": ");
  return redactCredentials(joined === "" ? "no detail" : joined).slice(0, DETAIL_LIMIT);
}

/** A 403 is a content refusal only when X says so; anything else is treated as auth (fail-safe). */
export function isContentForbidden(body: unknown): boolean {
  const type = text(field(body, "type")) ?? "";
  const reason = text(field(body, "reason")) ?? "";
  if (AUTH_PROBLEM.test(type) || AUTH_PROBLEM.test(reason)) {
    return false;
  }
  return CONTENT_DETAIL.test(errorDetail(body));
}

const header = (headers: Headers, name: string): number | null => {
  const value = headers.get(name);
  return value === null || !/^\d+$/.test(value) ? null : Number(value);
};

const resetAt = (headers: Headers, prefix: string): Instant | null => {
  const reset = header(headers, `${prefix}-reset`);
  return reset === null ? null : reset * SECOND;
};

/**
 * Who a 429 applies to and when it lifts. An exhausted `x-app-limit-24hour-*` window is the
 * app's (every account waits); otherwise the user's 24-hour or 15-minute `x-rate-limit-*` window.
 */
export function rateLimit(headers: Headers): { scope: RateScope; retryAt: Instant | null } {
  if (header(headers, "x-app-limit-24hour-remaining") === 0) {
    return { scope: "app", retryAt: resetAt(headers, "x-app-limit-24hour") };
  }
  if (header(headers, "x-user-limit-24hour-remaining") === 0) {
    return { scope: "user", retryAt: resetAt(headers, "x-user-limit-24hour") };
  }
  return { scope: "user", retryAt: resetAt(headers, "x-rate-limit") };
}

/** The `XFailure` for a non-2xx response whose body has been read (plan §3.5). */
export function failureFor(status: number, headers: Headers, body: unknown): XFailure {
  const detail = errorDetail(body);
  if (status === 403 && isContentForbidden(body)) {
    return { kind: "content_refused", status, detail };
  }
  const limit = status === 429 ? rateLimit(headers) : { scope: "user" as const, retryAt: null };
  return { kind: "http", status, detail, ...limit };
}
