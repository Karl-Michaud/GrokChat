import { redactCredentials } from "../security/redact";
import { MINUTE, type Instant } from "../time/instant";
import type { XFailure } from "./x_failure";

/** What a failed X call means for the part being published (plan §3.1 `mapXOutcome`). */
export type XOutcome =
  | { readonly kind: "retryable"; readonly retryAt: Instant }
  /** A 429 on the user's window: this account waits. */
  | { readonly kind: "rate_limited"; readonly retryAt: Instant }
  /** A 429 on the app's window: every account waits, and the tick stops dispatching. */
  | { readonly kind: "app_rate_limited"; readonly retryAt: Instant }
  | { readonly kind: "unknown" }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "needs_reconnect" };

/** A retry without a `retry-at` from X waits one minute (plan §3.1.1). */
export const DEFAULT_RETRY = MINUTE;

const rejected = (status: number, detail: string): XOutcome => ({
  kind: "rejected",
  reason: redactCredentials(`x_${String(status)}: ${detail}`),
});

/**
 * Not sent → retryable; sent without a response or a 5xx → unknown (never re-sent); 429 →
 * rate-limited, for the user or the whole app; 401, an auth 403 or no usable token → the token was
 * revoked, so the account needs a reconnect and the post goes back as a gate refusal, never
 * FAILED; a content refusal (a 403 for duplicate or forbidden content) and any other status →
 * rejected, its detail redacted.
 */
export function mapXOutcome(failure: XFailure, now: Instant): XOutcome {
  switch (failure.kind) {
    case "not_sent":
      return { kind: "retryable", retryAt: now + DEFAULT_RETRY };
    case "no_token":
      return { kind: "needs_reconnect" };
    case "content_refused":
      return rejected(failure.status, failure.detail);
    case "no_response":
      return { kind: "unknown" };
    case "http":
      return mapHttpStatus(failure, now);
  }
}

function mapHttpStatus(failure: Extract<XFailure, { kind: "http" }>, now: Instant): XOutcome {
  if (failure.status >= 500) {
    return { kind: "unknown" };
  }
  if (failure.status === 429) {
    const retryAt = failure.retryAt ?? now + DEFAULT_RETRY;
    return failure.scope === "app"
      ? { kind: "app_rate_limited", retryAt }
      : { kind: "rate_limited", retryAt };
  }
  if (failure.status === 401 || failure.status === 403) {
    return { kind: "needs_reconnect" };
  }
  return rejected(failure.status, failure.detail);
}

/** The reason a reply X refused with a 403 is REJECTED with (GROKCHAT-17, incident 2026-10-28). */
export const REPLY_REFUSED = "reply_refused";

/** X's answer to a failed call, its status and detail; null when X sent none. */
function answerOf(failure: XFailure): { readonly status: number; readonly detail: string } | null {
  return failure.kind === "http" || failure.kind === "content_refused" ? failure : null;
}

/**
 * A failed create. X allows API replies only to the account's own posts or to authors who engaged
 * with it, and refuses any other reply with a 403 whose wording has changed before; so a 403 on a
 * part sent as a reply is X refusing that reply, never the token: the part is rejected as
 * `reply_refused` (the post ends FAILED, the account stays ACTIVE, nothing is retried). A 401
 * stays a reconnect, and every other create maps as `mapXOutcome`.
 */
export function mapCreateOutcome(failure: XFailure, now: Instant, reply: boolean): XOutcome {
  return reply && answerOf(failure)?.status === 403
    ? { kind: "rejected", reason: REPLY_REFUSED }
    : mapXOutcome(failure, now);
}

/**
 * The audit detail of a failed create: what it meant (`reply_refused` for a refused reply, else
 * the outcome's kind) and, when X answered, its status and detail (already cut to 300
 * characters), redacted, so X's real wording is on record.
 */
export function createFailureDetail(outcome: XOutcome, failure: XFailure): string {
  const meaning = outcome.kind === "rejected" ? rejectedMeaning(outcome.reason) : outcome.kind;
  const answer = answerOf(failure);
  const said = answer === null ? "" : `: x_${String(answer.status)}: ${answer.detail}`;
  return redactCredentials(`${meaning}${said}`);
}

function rejectedMeaning(reason: string): string {
  return reason === REPLY_REFUSED ? REPLY_REFUSED : "rejected";
}
