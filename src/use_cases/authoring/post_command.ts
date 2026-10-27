import type { Actor } from "../../entities/identity/actor";
import type { PostId } from "../../entities/identity/ids";
import type { Post } from "../../entities/posts/post";
import type { PostEvent } from "../../entities/posts/post_event";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import { refusal, type Refusal } from "../access/refusal";
import type { PostReader } from "../ports/post_reader";
import type { GuardedTransition } from "../run_services/guarded_transition";
import { toPostView, type PostView } from "../views/post_view";

export type CommandCode =
  "not_found" | "scope" | "human_only" | "invalid_transition" | "version_conflict";

export type CommandResult<Extra extends string = never> =
  { readonly ok: true; readonly post: PostView } | Refusal<CommandCode | Extra>;

export interface Command<Extra extends string> {
  readonly actor: Actor;
  readonly postId: PostId;
  readonly action: string;
  readonly humanOnly: boolean;
  /** The event to apply to the loaded post, or a refusal of the command's own. */
  readonly event: (post: Post) => Promise<PostEvent | Refusal<Extra>>;
  /** Runs after the new post is written, before the audit. */
  readonly after?: (post: Post) => Promise<void>;
}

/** Load, authorise, apply one §3.1.1 event under the version guard, audit: every post command. */
export class PostCommand {
  constructor(
    private readonly reader: PostReader,
    private readonly steps: GuardedTransition,
    private readonly guard: AccessGuard,
    private readonly audit: ActionAudit,
  ) {}

  async run<Extra extends string = never>(command: Command<Extra>): Promise<CommandResult<Extra>> {
    const post = await this.reader.get(command.postId);
    if (post === null) {
      return refusal("not_found");
    }
    const action = {
      actor: command.actor,
      action: command.action,
      accountId: post.accountId,
      postId: post.id,
    };
    if (!(await this.guard.inScope(action))) {
      return refusal("scope");
    }
    if (command.humanOnly && !(await this.guard.humanOnly(action))) {
      return refusal("human_only");
    }
    const event = await command.event(post);
    if ("ok" in event) {
      return event;
    }
    const result = await this.steps.apply(post, event);
    if (result.kind !== "ok") {
      return refusal(result.kind);
    }
    await command.after?.(result.post);
    await this.audit.done(action, event.kind);
    return { ok: true, post: toPostView(result.post) };
  }
}
