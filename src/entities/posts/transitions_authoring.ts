import type { Lifecycle, Post } from "./post";
import { allPartsPending } from "./post";
import type { PostEvent } from "./post_event";
import { derivedStatus } from "./derived_status";
import { PENDING } from "./part_state";
import { stateAt, withPart } from "./post_parts";

type EventOf<K extends PostEvent["kind"]> = Extract<PostEvent, { kind: K }>;

const EDITABLE: readonly Lifecycle[] = ["DRAFT", "PENDING_REVIEW", "SCHEDULED"];

function editable(post: Post): boolean {
  return EDITABLE.includes(post.lifecycle) && allPartsPending(post);
}

export function submit(post: Post, event: EventOf<"submit">): Post | null {
  if (post.lifecycle !== "DRAFT") {
    return null;
  }
  return { ...post, lifecycle: event.mode === "AUTO" ? "SCHEDULED" : "PENDING_REVIEW" };
}

export function edit(post: Post, event: EventOf<"edit">): Post | null {
  const pending = event.parts.every((part) => part.state.kind === "PENDING");
  if (!editable(post) || event.parts.length === 0 || !pending) {
    return null;
  }
  return { ...post, parts: event.parts, publishAt: event.publishAt };
}

export function cancel(post: Post): Post | null {
  if (editable(post)) {
    return { ...post, lifecycle: "CANCELLED" };
  }
  if (post.lifecycle === "RESUMING") {
    return { ...post, lifecycle: "DONE", resumeAt: null };
  }
  return null;
}

export function approve(post: Post, event: EventOf<"approve">): Post | null {
  if (post.lifecycle !== "PENDING_REVIEW") {
    return null;
  }
  return { ...post, lifecycle: "SCHEDULED", publishAt: Math.max(post.publishAt, event.now) };
}

export function reject(post: Post): Post | null {
  return post.lifecycle === "PENDING_REVIEW" ? { ...post, lifecycle: "CANCELLED" } : null;
}

/** A human re-schedules a MISSED or a FAILED post; every part starts again from PENDING. */
export function reschedule(post: Post, event: EventOf<"reschedule">): Post | null {
  if (post.lifecycle !== "MISSED" && derivedStatus(post) !== "FAILED") {
    return null;
  }
  return {
    ...post,
    lifecycle: "SCHEDULED",
    publishAt: event.publishAt,
    resumeAt: null,
    parts: post.parts.map((part) => ({ ...part, state: PENDING })),
  };
}

/** A human checked X and confirms a NOT_FOUND part was never posted: send it again. */
export function resend(post: Post, event: EventOf<"resend">): Post | null {
  if (post.lifecycle !== "DONE" || stateAt(post, event.part)?.kind !== "NOT_FOUND") {
    return null;
  }
  const pending = withPart(post, event.part, PENDING);
  if (event.part === 0) {
    return { ...pending, lifecycle: "SCHEDULED", publishAt: event.now, resumeAt: null };
  }
  return { ...pending, lifecycle: "RESUMING", resumeAt: event.now };
}
