import type { Instant } from "../time/instant";
import type { Post } from "./post";

/** When a waiting post is next due: SCHEDULED at publishAt, RESUMING at resumeAt; else never. */
export function dueAt(post: Post): Instant | null {
  if (post.lifecycle === "SCHEDULED") {
    return post.publishAt;
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
