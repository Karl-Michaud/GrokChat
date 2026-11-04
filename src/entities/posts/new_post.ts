import type { PublishMode } from "../accounts/posting_policy";
import type { AccountId, XPostId } from "../identity/ids";
import type { Instant } from "../time/instant";
import type { Post } from "./post";

/** A new post as `createPost` builds it: a DRAFT already submitted (§3.1.1, submit), version 1. */
export function newPost(draft: Omit<Post, "lifecycle" | "version">, mode: PublishMode): Post {
  return { ...draft, lifecycle: mode === "AUTO" ? "SCHEDULED" : "PENDING_REVIEW", version: 1 };
}

export interface RequestedPart {
  readonly text: string;
  readonly media: readonly string[];
}

/**
 * The canonical form of a create request, stored with the post: a retry with the same idempotency
 * key must carry the same request, or it is refused as `idempotency_mismatch` (rev 4 N6).
 */
export function requestHash(
  account: AccountId,
  parts: readonly RequestedPart[],
  publishAt: Instant | null,
  replyTo: XPostId | null,
): string {
  return JSON.stringify({
    account,
    parts: parts.map(({ text, media }) => ({ text, media })),
    publishAt,
    // Left out for an original post, so the hashes of posts stored before replies still match.
    ...(replyTo === null ? {} : { replyTo }),
  });
}
