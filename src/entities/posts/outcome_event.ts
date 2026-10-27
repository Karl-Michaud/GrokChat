import { STANDING_RETRY } from "../policy/publishable";
import type { Instant } from "../time/instant";
import { DEFAULT_RETRY, type XOutcome } from "../x/x_outcome";
import type { PostEvent } from "./post_event";

/**
 * The §3.1.1 event for a failed X call on part `part`. `sending` says whether the part was already
 * SENDING (the create) or still PENDING (its media upload): a PENDING part is deferred, never
 * UNKNOWN, since no post can have been created. A 401/403 goes back as a gate refusal.
 */
export function eventForOutcome(
  part: number,
  outcome: XOutcome,
  now: Instant,
  sending: boolean,
): PostEvent {
  const back = (resumeAt: Instant): PostEvent =>
    sending ? { kind: "retry", part, resumeAt } : { kind: "defer", part, resumeAt };
  switch (outcome.kind) {
    case "retryable":
    case "rate_limited":
    case "app_rate_limited":
      return back(outcome.retryAt);
    case "unknown":
      return sending ? { kind: "unknown", part } : back(now + DEFAULT_RETRY);
    case "rejected":
      return { kind: "rejected", part, reason: outcome.reason };
    case "needs_reconnect":
      return back(now + STANDING_RETRY);
  }
}
