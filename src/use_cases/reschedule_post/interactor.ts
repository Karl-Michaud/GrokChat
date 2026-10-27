import { derivedStatus } from "../../entities/posts/derived_status";
import type { Post } from "../../entities/posts/post";
import type { PostEvent } from "../../entities/posts/post_event";
import { refusal, type Refusal } from "../access/refusal";
import type { PostCommand } from "../authoring/post_command";
import type { Clock } from "../ports/clock";
import type { ReschedulePostInputBoundary } from "./input_boundary";
import type { ReschedulePostInputData } from "./input_data";
import type { ReschedulePostOutputBoundary } from "./output_boundary";

/**
 * Human only (rev 4 §3.3 #2): a FAILED or MISSED post is re-scheduled; a NOT_FOUND part is sent
 * again only with the confirmation that it is not on X, and the confirmation is audited.
 */
export class ReschedulePostInteractor implements ReschedulePostInputBoundary {
  constructor(
    private readonly command: PostCommand,
    private readonly clock: Clock,
    private readonly presenter: ReschedulePostOutputBoundary,
  ) {}

  async execute(input: ReschedulePostInputData): Promise<void> {
    const result = await this.command.run<"confirmation_required">({
      actor: input.actor,
      postId: input.postId,
      action: "post.reschedule",
      humanOnly: true,
      event: (post) => Promise.resolve(this.eventFor(post, input)),
    });
    this.presenter.present(result);
  }

  private eventFor(
    post: Post,
    input: ReschedulePostInputData,
  ): PostEvent | Refusal<"confirmation_required"> {
    if (derivedStatus(post) !== "NOT_FOUND") {
      return { kind: "reschedule", publishAt: input.publishAt };
    }
    if (!input.confirmedNotOnX) {
      return refusal("confirmation_required");
    }
    const part = post.parts.findIndex((candidate) => candidate.state.kind === "NOT_FOUND");
    return { kind: "resend", part, now: this.clock.now() };
  }
}
