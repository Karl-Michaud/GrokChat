import type { Post } from "../../entities/posts/post";
import type { PostEvent } from "../../entities/posts/post_event";
import { transition } from "../../entities/posts/transition";
import type { AuditEvent } from "../../entities/records/audit_event";
import type { CostEntry } from "../../entities/records/cost_entry";
import type { PostWriter } from "../ports/post_writer";

export type StepResult =
  | { readonly kind: "ok"; readonly post: Post }
  | { readonly kind: "invalid_transition" }
  | { readonly kind: "version_conflict" };

/** Applies one §3.1.1 event and writes the result, guarded on the version and lifecycle read. */
export class GuardedTransition {
  constructor(private readonly writer: PostWriter) {}

  async apply(post: Post, event: PostEvent): Promise<StepResult> {
    const result = transition(post, event);
    if (!result.ok) {
      return { kind: "invalid_transition" };
    }
    const saved = await this.writer.save(result.post, post.version, post.lifecycle);
    return saved.kind === "ok" ? { kind: "ok", post: result.post } : { kind: "version_conflict" };
  }

  /** The part's outcome with its audit and cost entries, in `commitPart`'s single batch. */
  async commit(
    post: Post,
    event: PostEvent,
    audit: AuditEvent,
    cost: CostEntry,
  ): Promise<StepResult> {
    const result = transition(post, event);
    if (!result.ok) {
      return { kind: "invalid_transition" };
    }
    const saved = await this.writer.commitPart(
      result.post,
      post.version,
      post.lifecycle,
      audit,
      cost,
    );
    return saved.kind === "ok" ? { kind: "ok", post: result.post } : { kind: "version_conflict" };
  }
}
