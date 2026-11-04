import type { Instant, Millis } from "../time/instant";
import { eligibleAt } from "./due";
import { allPartsPending, type Post } from "./post";

/**
 * A scheduled post that nothing has started is missed once `grace` has passed since it was last
 * eligible: max(publishAt, the not-before time a deferral or a retry set). A post held back by the
 * gate or by X's retryAt is therefore never missed for waiting; only one that was eligible and not
 * run within grace is. A partly sent thread (RESUMING) is never missed (plan §3.1.1).
 */
export function missed(post: Post, now: Instant, grace: Millis): boolean {
  return post.lifecycle === "SCHEDULED" && allPartsPending(post) && now > eligibleAt(post) + grace;
}
