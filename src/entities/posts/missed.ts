import type { Instant, Millis } from "../time/instant";
import { allPartsPending, type Post } from "./post";

/**
 * A scheduled post that nothing has started is missed once `grace` has passed since its original
 * `publishAt` (rev 4 M3). A partly sent thread (RESUMING) is never missed.
 */
export function missed(post: Post, now: Instant, grace: Millis): boolean {
  return post.lifecycle === "SCHEDULED" && allPartsPending(post) && now > post.publishAt + grace;
}
