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

/**
 * The token call is never cut short (plan §3.5, A2): aborting it after X rotated the refresh token
 * would lose the account. Its timeout, a minute, is also its worst case.
 */
export const TOKEN_REFRESH_MILLIS: Millis = 60 * SECOND;

/**
 * The token step before each part (N1): one call to X's token endpoint (the token store is the
 * DO's own storage), its audit and cost entries, and marking the account NEEDS_RECONNECT in D1
 * (load + save) if it is lost. Its wall time is the refresh's un-aborted worst case, so a refresh
 * is only started when the whole of it fits the deadline.
 */
export const TOKEN_STEP_COST: CallCost = {
  cloudflareCalls: 4,
  externalSubrequests: 1,
  millis: TOKEN_REFRESH_MILLIS,
};

/**
 * The token step's calls without its wall time: what a run checks before asking for a token. The
 * wall time only applies when a refresh is needed, and `TokenProvider` checks it against the
 * deadline itself (`refresh_does_not_fit`), so a valid token is never refused for want of a minute.
 */
export const TOKEN_STEP_CALLS: CallCost = { ...TOKEN_STEP_COST, millis: 0 };

/**
 * One reconcile check: the timeline read, its audit and cost entries, the post's save, and the
 * account's X user id, which the timeline driver needs for `GET /2/users/:id/tweets`.
 */
export const RECONCILE_CHECK_COST: CallCost = {
  cloudflareCalls: 4,
  externalSubrequests: 1,
  millis: 2 * SECOND,
};

/** One metrics read of ≤ 100 posts: the read, its audit and cost entries, and the snapshots. */
export const METRICS_READ_COST: CallCost = {
  cloudflareCalls: 3,
  externalSubrequests: 1,
  millis: 2 * SECOND,
};

/**
 * The daily follower snapshot (GROKCHAT-15): the day's claim, the user read, its audit and cost
 * entries, and storing the counts (or giving the claim back).
 */
export const FOLLOWER_READ_COST: CallCost = {
  cloudflareCalls: 4,
  externalSubrequests: 1,
  millis: 2 * SECOND,
};

/**
 * The metrics tick's staged-media cleanup (plan §3.5, U16): one D1 query selects the items whose
 * retention has passed, oldest staged first, at most `MEDIA_CLEANUP_BATCH`; each item then costs
 * the R2 delete, the usage record and the row delete. The rest waits for the next tick.
 */
export const MEDIA_CLEANUP_BATCH = 100;
export const MEDIA_CLEANUP_QUERY_COST: CallCost = {
  cloudflareCalls: 1,
  externalSubrequests: 0,
  millis: SECOND,
};
export const MEDIA_CLEANUP_ITEM_COST: CallCost = {
  cloudflareCalls: 3,
  externalSubrequests: 0,
  millis: SECOND,
};

/**
 * Per staged media item: metadata, the usage row (read and count), the R2 read, the audit and
 * cost entries.
 */
const MEDIA_CLOUDFLARE_CALLS = 6;
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

/** The worst case for a part with `count` media items: one item may be a GIF; several are photos. */
export function partCostForMediaCount(count: number): CallCost {
  const kinds: readonly MediaKind[] =
    count === 1 ? ["GIF"] : Array.from({ length: count }, () => "PHOTO");
  return partCost(kinds);
}
