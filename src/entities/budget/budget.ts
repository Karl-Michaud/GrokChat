import type { MediaKind } from "../content/staged_media";
import { SECOND, type Instant, type Millis } from "../time/instant";

/**
 * What one Workers invocation may still spend (plan §3.2 `Budget`, U16): a deadline, Cloudflare-
 * service calls (D1 queries and DO calls share one pool of 1,000) and external fetches (50).
 */
export interface Budget {
  readonly deadline: Instant;
  readonly cloudflareCalls: number;
  readonly externalSubrequests: number;
}

/** The worst case of a step: calls by pool, and an estimate of its wall time. */
export interface CallCost {
  readonly cloudflareCalls: number;
  readonly externalSubrequests: number;
  readonly millis: Millis;
}

export const INVOCATION_LIMITS = { cloudflareCalls: 1_000, externalSubrequests: 50 } as const;

export function invocationBudget(deadline: Instant): Budget {
  return { deadline, ...INVOCATION_LIMITS };
}

export function fits(budget: Budget, cost: CallCost, now: Instant): boolean {
  return (
    now + cost.millis <= budget.deadline &&
    cost.cloudflareCalls <= budget.cloudflareCalls &&
    cost.externalSubrequests <= budget.externalSubrequests
  );
}

export function spend(budget: Budget, cost: Omit<CallCost, "millis">): Budget {
  return {
    deadline: budget.deadline,
    cloudflareCalls: budget.cloudflareCalls - cost.cloudflareCalls,
    externalSubrequests: budget.externalSubrequests - cost.externalSubrequests,
  };
}

/** The tick's fan-out ceiling: each dispatch costs it one Cloudflare-service call (U16). */
export const FANOUT_CEILING = 200;
export const DISPATCH_COST: CallCost = { cloudflareCalls: 1, externalSubrequests: 0, millis: 0 };

/** A refresh: one call to X's token endpoint; the token store is the DO's own storage. */
export const TOKEN_REFRESH_COST: CallCost = {
  cloudflareCalls: 0,
  externalSubrequests: 1,
  millis: 5 * SECOND,
};

/** Per staged media item: metadata, the R2 read, the usage count, the audit and cost entries. */
const MEDIA_CLOUDFLARE_CALLS = 5;
/** A GIF is chunked: INIT, ≤ 3 APPENDs of 5 MB, FINALIZE and ≤ 6 STATUS polls. */
const UPLOAD_CALLS: Readonly<Record<MediaKind, number>> = { PHOTO: 1, GIF: 11 };
const UPLOAD_MILLIS: Readonly<Record<MediaKind, Millis>> = { PHOTO: SECOND, GIF: 5 * SECOND };

/**
 * A part's worst case (plan §3.3 #4, A4): load the account and the recent activity, write SENDING,
 * stage the media, create, commit, and possibly mark the account NEEDS_RECONNECT.
 */
export function partCost(media: readonly MediaKind[]): CallCost {
  return {
    cloudflareCalls: 5 + MEDIA_CLOUDFLARE_CALLS * media.length,
    externalSubrequests: 1 + media.reduce((sum, kind) => sum + UPLOAD_CALLS[kind], 0),
    millis: 2 * SECOND + media.reduce((sum, kind) => sum + UPLOAD_MILLIS[kind], 0),
  };
}
