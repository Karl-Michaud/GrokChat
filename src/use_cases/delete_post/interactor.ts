import { derivedStatus, type DerivedStatus } from "../../entities/posts/derived_status";
import type { Post } from "../../entities/posts/post";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit, AuditedAction } from "../access/action_audit";
import { refusal } from "../access/refusal";
import type { AccountXGateway } from "../ports/account_x_gateway";
import type { PostReader } from "../ports/post_reader";
import type { GuardedTransition } from "../run_services/guarded_transition";
import { toPostView } from "../views/post_view";
import type { DeletePostInputBoundary } from "./input_boundary";
import type { DeletePostInputData } from "./input_data";
import type { DeletePostOutputBoundary } from "./output_boundary";
import type { DeletePostOutputData } from "./output_data";

const DELETABLE: readonly DerivedStatus[] = [
  "PUBLISHED",
  "PARTIALLY_PUBLISHED",
  "DELETE_INCOMPLETE",
];

export interface DeletePostPorts {
  readonly reader: PostReader;
  readonly gateway: AccountXGateway;
  readonly steps: GuardedTransition;
  readonly guard: AccessGuard;
  readonly audit: ActionAudit;
}

/** Deletes our own post on X, last part first, through the account's DO (plan §3.3 #7). */
export class DeletePostInteractor implements DeletePostInputBoundary {
  constructor(
    private readonly ports: DeletePostPorts,
    private readonly presenter: DeletePostOutputBoundary,
  ) {}

  async execute(input: DeletePostInputData): Promise<void> {
    this.presenter.present(await this.delete(input));
  }

  private async delete(input: DeletePostInputData): Promise<DeletePostOutputData> {
    const post = await this.ports.reader.get(input.postId);
    if (post === null) {
      return refusal("not_found");
    }
    const action = {
      actor: input.actor,
      action: "post.delete",
      accountId: post.accountId,
      postId: post.id,
    };
    if (!(await this.ports.guard.inScope(action))) {
      return refusal("scope");
    }
    if (!DELETABLE.includes(derivedStatus(post))) {
      return refusal("not_deletable");
    }
    return this.deleteOnX(post, action);
  }

  private async deleteOnX(post: Post, action: AuditedAction): Promise<DeletePostOutputData> {
    const sent = post.parts
      .flatMap((part, index) =>
        part.state.kind === "SENT" ? [{ index, xPostId: part.state.xPostId }] : [],
      )
      .reverse();
    const outcomes = await this.ports.gateway.deletePost(
      post.accountId,
      sent.map((item) => item.xPostId),
    );
    const deleted = sent.filter((item) =>
      outcomes.some((o) => o.xPostId === item.xPostId && o.deleted),
    );
    const result = await this.markDeleted(
      post,
      deleted.map((item) => item.index),
    );
    if (result === null) {
      return refusal("version_conflict");
    }
    await this.ports.audit.done(
      action,
      `deleted ${String(deleted.length)} of ${String(sent.length)}`,
    );
    return {
      ok: true,
      post: toPostView(result),
      deleted: deleted.length,
      incomplete: deleted.length < sent.length,
    };
  }

  private async markDeleted(post: Post, parts: readonly number[]): Promise<Post | null> {
    let current = post;
    for (const part of parts) {
      const result = await this.ports.steps.apply(current, { kind: "deleted", part });
      if (result.kind !== "ok") {
        return null;
      }
      current = result.post;
    }
    return current;
  }
}
