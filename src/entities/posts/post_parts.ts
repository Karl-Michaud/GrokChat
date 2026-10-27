import type { Instant } from "../time/instant";
import type { PartState } from "./part_state";
import { anyPartIn, type Post } from "./post";

/** Building blocks shared by the transition handlers. */

export function stateAt(post: Post, part: number): PartState | undefined {
  return post.parts[part]?.state;
}

export function withPart(post: Post, part: number, state: PartState): Post {
  return {
    ...post,
    parts: post.parts.map((current, index) => (index === part ? { ...current, state } : current)),
  };
}

export function isLastPart(post: Post, part: number): boolean {
  return part === post.parts.length - 1;
}

/**
 * Back to the queue at `resumeAt` (the gate's next allowed time, X's retryAt, or now): nothing
 * sent yet → SCHEDULED, not before `resumeAt` (publishAt kept; `missed` counts from the later of
 * the two); some part sent → RESUMING at `resumeAt` (plan §3.1.1).
 */
export function backToQueue(post: Post, resumeAt: Instant): Post {
  const lifecycle = anyPartIn(post, "SENT") ? "RESUMING" : "SCHEDULED";
  return { ...post, lifecycle, resumeAt };
}
