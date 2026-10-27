import type { PostCommand } from "../authoring/post_command";
import type { CancelPostInputBoundary } from "./input_boundary";
import type { CancelPostInputData } from "./input_data";
import type { CancelPostOutputBoundary } from "./output_boundary";

/** Cancel a waiting post, or stop a partly sent thread (RESUMING → DONE), plan §3.1.1. */
export class CancelPostInteractor implements CancelPostInputBoundary {
  constructor(
    private readonly command: PostCommand,
    private readonly presenter: CancelPostOutputBoundary,
  ) {}

  async execute(input: CancelPostInputData): Promise<void> {
    const result = await this.command.run({
      actor: input.actor,
      postId: input.postId,
      action: "post.cancel",
      humanOnly: false,
      event: () => Promise.resolve({ kind: "cancel" }),
    });
    this.presenter.present(result);
  }
}
