import type { Post } from "./post";
import type { PostEvent, PostEventKind } from "./post_event";
import { reconcileFound, reconcileNotFound, deleted } from "./transitions_after";
import { approve, cancel, edit, reject, reschedule, resend, submit } from "./transitions_authoring";
import {
  defer,
  miss,
  recover,
  rejected,
  reserve,
  retry,
  sent,
  start,
  unknown,
  yieldPost,
} from "./transitions_publishing";

export type TransitionResult =
  | { readonly ok: true; readonly post: Post }
  | { readonly ok: false; readonly reason: "invalid_transition" };

const INVALID: TransitionResult = { ok: false, reason: "invalid_transition" };

/**
 * The §3.1.1 state machine. Any (state, event) pair the table does not list is refused. Every
 * accepted event bumps `version`, so every write can be guarded on it.
 */
export function transition(post: Post, event: PostEvent): TransitionResult {
  const next = apply(post, event);
  return next === null ? INVALID : { ok: true, post: { ...next, version: post.version + 1 } };
}

type Handler = (post: Post, event: PostEvent) => Post | null;
type HandlerOf<K extends PostEventKind> = (
  post: Post,
  event: Extract<PostEvent, { kind: K }>,
) => Post | null;

const HANDLERS: { readonly [K in PostEventKind]: HandlerOf<K> } = {
  submit,
  edit,
  cancel,
  approve,
  reject,
  reschedule,
  resend,
  start,
  miss,
  reserve,
  defer,
  sent,
  unknown,
  rejected,
  retry,
  yield: yieldPost,
  recover,
  reconcileFound,
  reconcileNotFound,
  deleted,
};

function apply(post: Post, event: PostEvent): Post | null {
  const handler = HANDLERS[event.kind] as Handler;
  return handler(post, event);
}
