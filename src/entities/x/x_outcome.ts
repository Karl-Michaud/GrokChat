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

/**
 * Not sent → retryable; sent without a response or a 5xx → unknown (never re-sent); 429 →
 * rate-limited, for the user or the whole app; 401/403 → the token was revoked, so the account
 * needs a reconnect and the post goes back as a gate refusal, never FAILED; any other status →
 * rejected, its detail redacted.
 */
export function mapXOutcome(failure: XFailure, now: Instant): XOutcome {
  if (failure.kind === "not_sent") {
    return { kind: "retryable", retryAt: now + DEFAULT_RETRY };
  }
  if (failure.kind === "no_response" || failure.status >= 500) {
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
  return {
    kind: "rejected",
    reason: redactCredentials(`x_${String(failure.status)}: ${failure.detail}`),
  };
}
