import type { StagedMedia } from "../content/staged_media";
import type { Post } from "../posts/post";
import { DAY, type Instant } from "../time/instant";

/** Staged media is kept 7 days after its post is done, or 2 days if never used (plan §3.5). */
export const KEEP_AFTER_DONE = 7 * DAY;
export const KEEP_UNUSED = 2 * DAY;

/**
 * `post` is the post the media is attached to, if it still exists. A cancelled or missed post
 * never used it; a post still waiting or publishing keeps it.
 */
export function mediaCleanupDue(media: StagedMedia, post: Post | null, now: Instant): boolean {
  if (post === null || post.lifecycle === "CANCELLED" || post.lifecycle === "MISSED") {
    return now >= media.stagedAt + KEEP_UNUSED;
  }
  if (post.lifecycle !== "DONE") {
    return false;
  }
  const sentAt = post.parts.flatMap((part) => (part.state.kind === "SENT" ? [part.state.at] : []));
  return now >= Math.max(media.stagedAt, ...sentAt) + KEEP_AFTER_DONE;
}
