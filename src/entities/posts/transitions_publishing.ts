import { missed } from "./missed";
import { anyPartIn, currentPartIndex, type Post } from "./post";
import type { PostEvent } from "./post_event";
import { PENDING } from "./part_state";
import { backToQueue, isLastPart, stateAt, withPart } from "./post_parts";

type EventOf<K extends PostEvent["kind"]> = Extract<PostEvent, { kind: K }>;

/** The Durable Object starts a due post (plan §3.1.1). */
export function start(post: Post, event: EventOf<"start">): Post | null {
  if (post.lifecycle === "SCHEDULED") {
    const due = event.now >= post.publishAt && !missed(post, event.now, event.grace);
    return due ? { ...post, lifecycle: "PUBLISHING" } : null;
  }
  if (post.lifecycle === "RESUMING" && post.resumeAt !== null && event.now >= post.resumeAt) {
    return { ...post, lifecycle: "PUBLISHING", resumeAt: null };
  }
  return null;
}

export function miss(post: Post, event: EventOf<"miss">): Post | null {
  return missed(post, event.now, event.grace) ? { ...post, lifecycle: "MISSED" } : null;
}

/** The part a publish run may act on: the first part not SENT, while PUBLISHING. */
function current(post: Post, part: number): boolean {
  return post.lifecycle === "PUBLISHING" && currentPartIndex(post) === part;
}

function currentIn(post: Post, part: number, kinds: readonly string[]): boolean {
  const state = stateAt(post, part);
  return current(post, part) && state !== undefined && kinds.includes(state.kind);
}

/** ReservePart Allowed: SENDING is written (and awaited) before the X call. */
export function reserve(post: Post, event: EventOf<"reserve">): Post | null {
  if (!currentIn(post, event.part, ["PENDING"])) {
    return null;
  }
  return withPart(post, event.part, { kind: "SENDING", attemptAt: event.now });
}

/** A gate refusal, a token that needs a reconnect, or media that could not be staged yet. */
export function defer(post: Post, event: EventOf<"defer">): Post | null {
  return currentIn(post, event.part, ["PENDING"]) ? backToQueue(post, event.resumeAt) : null;
}

export function sent(post: Post, event: EventOf<"sent">): Post | null {
  if (!currentIn(post, event.part, ["SENDING"])) {
    return null;
  }
  const next = withPart(post, event.part, { kind: "SENT", xPostId: event.xPostId, at: event.now });
  return isLastPart(post, event.part) ? { ...next, lifecycle: "DONE" } : next;
}

/** The attempt time of the current part, when it is SENDING. */
function sendingAttempt(post: Post, part: number): number | null {
  const state = stateAt(post, part);
  return current(post, part) && state?.kind === "SENDING" ? state.attemptAt : null;
}

export function unknown(post: Post, event: EventOf<"unknown">): Post | null {
  const attemptAt = sendingAttempt(post, event.part);
  if (attemptAt === null) {
    return null;
  }
  const outcome = { kind: "UNKNOWN", attemptAt, checks: 0 } as const;
  return { ...withPart(post, event.part, outcome), lifecycle: "DONE" };
}

export function rejected(post: Post, event: EventOf<"rejected">): Post | null {
  if (!currentIn(post, event.part, ["PENDING", "SENDING"])) {
    return null;
  }
  const next = withPart(post, event.part, { kind: "REJECTED", reason: event.reason });
  return { ...next, lifecycle: "DONE" };
}

/** Retryable, 429 or an auth error from `create`: X did not create it, so the part is PENDING. */
export function retry(post: Post, event: EventOf<"retry">): Post | null {
  if (!currentIn(post, event.part, ["SENDING"])) {
    return null;
  }
  return backToQueue(withPart(post, event.part, PENDING), event.resumeAt);
}

/** The run's budget is spent: give the post back before the next part, never mid-send. */
export function yieldPost(post: Post, event: EventOf<"yield">): Post | null {
  if (post.lifecycle !== "PUBLISHING" || anyPartIn(post, "SENDING")) {
    return null;
  }
  return backToQueue(post, event.now);
}

/**
 * A PUBLISHING post found under `publishLock` is dead by construction (A3): a SENDING part may
 * have reached X, so it becomes UNKNOWN and is never re-sent; otherwise the post is re-queued.
 */
export function recover(post: Post, event: EventOf<"recover">): Post | null {
  if (post.lifecycle !== "PUBLISHING") {
    return null;
  }
  const sending = post.parts.findIndex((part) => part.state.kind === "SENDING");
  const state = stateAt(post, sending);
  if (state?.kind === "SENDING") {
    const outcome = { kind: "UNKNOWN", attemptAt: state.attemptAt, checks: 0 } as const;
    return { ...withPart(post, sending, outcome), lifecycle: "DONE" };
  }
  return backToQueue(post, event.now);
}
