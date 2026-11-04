import type { StagedMedia } from "../content/staged_media";
import type { Post } from "../posts/post";
import { DAY, type Instant } from "../time/instant";

/** Staged media is kept 7 days after its post is done, or 2 days if never used (plan §3.5). */
export const KEEP_AFTER_DONE = 7 * DAY;
export const KEEP_UNUSED = 2 * DAY;

/**
 * `post` is the post the media is attached to, if it still exists. A cancelled or missed post
 * never used it, so the media counts as unused (and may be deleted on the dashboard).
 */
export function mediaInUse(post: Post | null): post is Post {
  return post !== null && post.lifecycle !== "CANCELLED" && post.lifecycle !== "MISSED";
}

/**
 * When the cleanup deletes the media: 2 days after staging while unused, 7 days after the later
 * of staging and the post's last sent part once the post is done; null while a post still waiting
 * or publishing holds it (GROKCHAT-18: `list_media` shows it as `expires_at`).
 */
export function mediaExpiresAt(media: StagedMedia, post: Post | null): Instant | null {
  if (!mediaInUse(post)) {
    return media.stagedAt + KEEP_UNUSED;
  }
  if (post.lifecycle !== "DONE") {
    return null;
  }
  const sentAt = post.parts.flatMap((part) => (part.state.kind === "SENT" ? [part.state.at] : []));
  return Math.max(media.stagedAt, ...sentAt) + KEEP_AFTER_DONE;
}

export function mediaCleanupDue(media: StagedMedia, post: Post | null, now: Instant): boolean {
  const expiresAt = mediaExpiresAt(media, post);
  return expiresAt !== null && now >= expiresAt;
}
