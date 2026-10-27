import { actorLabel } from "../../entities/identity/actor";
import type { AccountId, PostId, XPostId } from "../../entities/identity/ids";
import type { PartStateKind } from "../../entities/posts/part_state";
import { derivedStatus, type DerivedStatus } from "../../entities/posts/derived_status";
import type { Lifecycle, Post } from "../../entities/posts/post";
import type { Instant } from "../../entities/time/instant";

export interface PartView {
  readonly text: string;
  readonly state: PartStateKind;
  readonly xPostId: XPostId | null;
}

/** A post as the read side and the tools show it: never a token, never a request hash. */
export interface PostView {
  readonly id: PostId;
  readonly accountId: AccountId;
  readonly status: DerivedStatus;
  readonly lifecycle: Lifecycle;
  readonly publishAt: Instant;
  readonly resumeAt: Instant | null;
  readonly parts: readonly PartView[];
  readonly createdBy: string;
  readonly version: number;
}

export function toPostView(post: Post): PostView {
  return {
    id: post.id,
    accountId: post.accountId,
    status: derivedStatus(post),
    lifecycle: post.lifecycle,
    publishAt: post.publishAt,
    resumeAt: post.resumeAt,
    parts: post.parts.map((part) => ({
      text: part.text,
      state: part.state.kind,
      xPostId:
        part.state.kind === "SENT" || part.state.kind === "DELETED" ? part.state.xPostId : null,
    })),
    createdBy: actorLabel(post.createdBy),
    version: post.version,
  };
}
