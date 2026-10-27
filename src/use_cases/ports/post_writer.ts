import type { Lifecycle, Post } from "../../entities/posts/post";
import type { AuditEvent } from "../../entities/records/audit_event";
import type { CostEntry } from "../../entities/records/cost_entry";

export type AddResult =
  { readonly kind: "added" } | { readonly kind: "duplicate"; readonly existing: Post };

export type SaveResult = { readonly kind: "ok" } | { readonly kind: "version_conflict" };

export interface PostWriter {
  /** Unique on (bot, idempotency key): a second add with the same pair returns the first post. */
  add(post: Post): Promise<AddResult>;
  /** Writes only if the stored post still has this version and lifecycle (plan §3.5). */
  save(post: Post, expectedVersion: number, expectedLifecycle: Lifecycle): Promise<SaveResult>;
  /**
   * One guarded batch: the version guard first, then the post with its part, the audit event and
   * the cost entry, so a part costs a fixed number of queries (M2-feas, A4).
   */
  commitPart(
    post: Post,
    expectedVersion: number,
    audit: AuditEvent,
    cost: CostEntry,
  ): Promise<SaveResult>;
}
