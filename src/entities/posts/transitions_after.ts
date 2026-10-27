import { derivedStatus, type DerivedStatus } from "./derived_status";
import type { Post } from "./post";
import type { PostEvent } from "./post_event";
import { isLastPart, stateAt, withPart } from "./post_parts";

type EventOf<K extends PostEvent["kind"]> = Extract<PostEvent, { kind: K }>;

/** Reconcile found the UNKNOWN part on X: it is SENT, and the rest of the thread resumes. */
export function reconcileFound(post: Post, event: EventOf<"reconcileFound">): Post | null {
  if (post.lifecycle !== "DONE" || stateAt(post, event.part)?.kind !== "UNKNOWN") {
    return null;
  }
  const next = withPart(post, event.part, { kind: "SENT", xPostId: event.xPostId, at: event.now });
  return isLastPart(post, event.part)
    ? next
    : { ...next, lifecycle: "RESUMING", resumeAt: event.now };
}

/** Not found on the first check: checked again later; not found twice: NOT_FOUND. */
export function reconcileNotFound(post: Post, event: EventOf<"reconcileNotFound">): Post | null {
  const state = stateAt(post, event.part);
  if (post.lifecycle !== "DONE" || state?.kind !== "UNKNOWN") {
    return null;
  }
  if (state.checks >= 1) {
    return withPart(post, event.part, { kind: "NOT_FOUND", attemptAt: state.attemptAt });
  }
  return withPart(post, event.part, { ...state, checks: state.checks + 1 });
}

const DELETABLE: readonly DerivedStatus[] = [
  "PUBLISHED",
  "PARTIALLY_PUBLISHED",
  "DELETE_INCOMPLETE",
];

/** One SENT part deleted on X, last part first. */
export function deleted(post: Post, event: EventOf<"deleted">): Post | null {
  const state = stateAt(post, event.part);
  const later = post.parts.slice(event.part + 1).some((part) => part.state.kind === "SENT");
  if (!DELETABLE.includes(derivedStatus(post)) || state?.kind !== "SENT" || later) {
    return null;
  }
  return withPart(post, event.part, { kind: "DELETED", xPostId: state.xPostId });
}
