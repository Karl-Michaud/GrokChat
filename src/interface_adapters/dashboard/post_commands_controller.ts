import { postId, stagedMediaId } from "../../entities/identity/ids";
import type { Refusal } from "../../use_cases/access/refusal";
import type { PostView } from "../../use_cases/views/post_view";
import { ADMIN } from "./admin_actor";
import { filled, parseList, parseUtcDateTime } from "./form_values";
import { invalid, redirect, refused, type Outcome } from "./outcome";
import { postHref } from "./post_views";
import { runUseCase } from "./presenter";
import type { PostCommandUseCases } from "./use_cases";

export interface EditForm {
  /** One text per part, in order. */
  readonly texts: readonly string[];
  /** Per part, its staged media ids, comma-separated (hidden fields from the page). */
  readonly media: readonly string[];
  /** `YYYY-MM-DDTHH:MM` UTC; empty keeps the time. */
  readonly publishAt: string;
}

export interface RescheduleForm {
  readonly publishAt: string;
  readonly confirmedNotOnX: boolean;
}

type Result = { readonly ok: true; readonly post: PostView } | Refusal<string>;

/** Back to the post page when it worked; the refusal otherwise. */
function toOutcome(id: string) {
  return (output: Result): Outcome<never> =>
    output.ok ? redirect(postHref(id)) : refused(output.code);
}

/** The post page's buttons (plan §3.4): every command is the matching use case, as the admin. */
export class PostCommandsController {
  constructor(private readonly useCases: PostCommandUseCases) {}

  edit(id: string, form: EditForm): Promise<Outcome<never>> {
    const when = filled(form.publishAt);
    const publishAt = when === null ? null : parseUtcDateTime(when);
    if (when !== null && publishAt === null) {
      return Promise.resolve(invalid("The publish time must be YYYY-MM-DDTHH:MM (UTC)."));
    }
    const parts = form.texts.map((text, index) => ({
      text,
      media: parseList(form.media[index] ?? "").map(stagedMediaId),
    }));
    const input = { actor: ADMIN, postId: postId(id), parts, publishAt };
    return runUseCase(this.useCases.editPost, input, toOutcome(id));
  }

  approve(id: string): Promise<Outcome<never>> {
    return runUseCase(this.useCases.approvePost, this.target(id), toOutcome(id));
  }

  reject(id: string): Promise<Outcome<never>> {
    return runUseCase(this.useCases.rejectPost, this.target(id), toOutcome(id));
  }

  cancel(id: string): Promise<Outcome<never>> {
    return runUseCase(this.useCases.cancelPost, this.target(id), toOutcome(id));
  }

  delete(id: string): Promise<Outcome<never>> {
    return runUseCase(this.useCases.deletePost, this.target(id), toOutcome(id));
  }

  reschedule(id: string, form: RescheduleForm): Promise<Outcome<never>> {
    const publishAt = parseUtcDateTime(form.publishAt);
    if (publishAt === null) {
      return Promise.resolve(invalid("The publish time must be YYYY-MM-DDTHH:MM (UTC)."));
    }
    const input = { ...this.target(id), publishAt, confirmedNotOnX: form.confirmedNotOnX };
    return runUseCase(this.useCases.reschedulePost, input, toOutcome(id));
  }

  private target(id: string) {
    return { actor: ADMIN, postId: postId(id) };
  }
}
