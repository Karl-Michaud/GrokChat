import type { PostCommand } from "../authoring/post_command";
import type { RejectPostInputBoundary } from "./input_boundary";
import type { RejectPostInputData } from "./input_data";
import type { RejectPostOutputBoundary } from "./output_boundary";

/** A human rejects a post in review: CANCELLED (§3.1.1). */
export class RejectPostInteractor implements RejectPostInputBoundary {
  constructor(
    private readonly command: PostCommand,
    private readonly presenter: RejectPostOutputBoundary,
  ) {}

  async execute(input: RejectPostInputData): Promise<void> {
    const result = await this.command.run({
      actor: input.actor,
      postId: input.postId,
      action: "post.reject",
      humanOnly: true,
      event: () => Promise.resolve({ kind: "reject" }),
    });
    this.presenter.present(result);
  }
}
