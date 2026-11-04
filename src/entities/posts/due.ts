import type { Instant } from "../time/instant";
import type { Post } from "./post";

/**
 * When a waiting post is next due: SCHEDULED at publishAt, or later when a deferral or a retry
 * set a not-before time (`resumeAt`); RESUMING at resumeAt; else never (plan §3.1.1).
 */
export function dueAt(post: Post): Instant | null {
  if (post.lifecycle === "SCHEDULED") {
    return eligibleAt(post);
  }
  return post.lifecycle === "RESUMING" ? post.resumeAt : null;
}

export function isDue(post: Post, now: Instant): boolean {
  const due = dueAt(post);
  return due !== null && due <= now;
}

/** Oldest due first; posts that are never due sort last. */
export function compareDue(a: Post, b: Post): number {
  const left = dueAt(a) ?? Number.POSITIVE_INFINITY;
  const right = dueAt(b) ?? Number.POSITIVE_INFINITY;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The earliest a not-yet-started post may run: max(publishAt, its not-before time). */
export function eligibleAt(post: Post): Instant {
  return Math.max(post.publishAt, post.resumeAt ?? post.publishAt);
}
