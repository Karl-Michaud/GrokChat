import { MINUTE, type Instant } from "../time/instant";
import type { RateScope, XFailure } from "./x_failure";

/** What a failed X call means for the part being published (plan §3.1 `mapXOutcome`). */
export type XOutcome =
  | { readonly kind: "retryable"; readonly retryAt: Instant }
  | { readonly kind: "rate_limited"; readonly scope: RateScope; readonly retryAt: Instant }
  | { readonly kind: "unknown" }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "needs_reconnect" };

/** A retry without a `retry-at` from X waits one minute (plan §3.1.1). */
export const DEFAULT_RETRY = MINUTE;

/**
 * Not sent → retryable; sent without a response or a 5xx → unknown (never re-sent); 429 →
 * rate-limited by scope; 401/403 → the token was revoked, so the account needs a reconnect and the
 * post goes back as a gate refusal, never FAILED; any other status → rejected.
 */
export function mapXOutcome(failure: XFailure, now: Instant): XOutcome {
  if (failure.kind === "not_sent") {
    return { kind: "retryable", retryAt: now + DEFAULT_RETRY };
  }
  if (failure.kind === "no_response" || failure.status >= 500) {
    return { kind: "unknown" };
  }
  if (failure.status === 429) {
    return {
      kind: "rate_limited",
      scope: failure.scope,
      retryAt: failure.retryAt ?? now + DEFAULT_RETRY,
    };
  }
  if (failure.status === 401 || failure.status === 403) {
    return { kind: "needs_reconnect" };
  }
  return { kind: "rejected", reason: `x_${String(failure.status)}: ${failure.detail}` };
}
