import type { PostCommand } from "../authoring/post_command";
import type { Clock } from "../ports/clock";
import type { ApprovePostInputBoundary } from "./input_boundary";
import type { ApprovePostInputData } from "./input_data";
import type { ApprovePostOutputBoundary } from "./output_boundary";

/** A human approves a post in review: SCHEDULED, a past publishAt moved to now (§3.1.1). */
export class ApprovePostInteractor implements ApprovePostInputBoundary {
  constructor(
    private readonly command: PostCommand,
    private readonly clock: Clock,
    private readonly presenter: ApprovePostOutputBoundary,
  ) {}

  async execute(input: ApprovePostInputData): Promise<void> {
    const result = await this.command.run({
      actor: input.actor,
      postId: input.postId,
      action: "post.approve",
      humanOnly: true,
      event: () => Promise.resolve({ kind: "approve", now: this.clock.now() }),
    });
    this.presenter.present(result);
  }
}
