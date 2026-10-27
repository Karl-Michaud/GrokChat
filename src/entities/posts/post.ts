import type { PostingPolicy } from "../accounts/posting_policy";
import type { Actor } from "../identity/actor";
import type { AccountId, BotId, IdempotencyKey, PostId, StagedMediaId } from "../identity/ids";
import type { Instant } from "../time/instant";
import type { PartState } from "./part_state";

export type Lifecycle =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "SCHEDULED"
  | "RESUMING"
  | "PUBLISHING"
  | "DONE"
  | "CANCELLED"
  | "MISSED";

export const LIFECYCLES: readonly Lifecycle[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "SCHEDULED",
  "RESUMING",
  "PUBLISHING",
  "DONE",
  "CANCELLED",
  "MISSED",
];

/** One post of a thread (a single post is a thread of one). */
export interface PostPart {
  readonly text: string;
  readonly media: readonly StagedMediaId[];
  readonly state: PartState;
}

/** Who asked for the post and under which personality and policy (rev 4 m4). */
export interface Provenance {
  readonly botId: BotId | null;
  readonly personalityVersion: number;
  readonly policySnapshot: PostingPolicy;
}

export interface Post {
  readonly id: PostId;
  readonly accountId: AccountId;
  readonly parts: readonly PostPart[];
  readonly lifecycle: Lifecycle;
  /** The original publish time: `missed` is always measured from it (rev 4 M3). */
  readonly publishAt: Instant;
  /** When a partly sent thread resumes (RESUMING only). */
  readonly resumeAt: Instant | null;
  readonly idempotencyKey: IdempotencyKey | null;
  readonly requestHash: string;
  readonly createdBy: Actor;
  readonly provenance: Provenance;
  /** Bumped by every transition; every write is guarded on it (plan §3.5). */
  readonly version: number;
}

export function allPartsPending(post: Post): boolean {
  return post.parts.every((part) => part.state.kind === "PENDING");
}

export function anyPartIn(post: Post, kind: PartState["kind"]): boolean {
  return post.parts.some((part) => part.state.kind === kind);
}

/** The index of the first part not yet SENT: the next one a publish run works on. */
export function currentPartIndex(post: Post): number {
  return post.parts.findIndex((part) => part.state.kind !== "SENT");
}
