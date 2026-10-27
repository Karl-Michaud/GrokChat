import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { PostReader } from "../ports/post_reader";
import { toPostView } from "../views/post_view";
import type { GetPostInputBoundary } from "./input_boundary";
import type { GetPostInputData } from "./input_data";
import type { GetPostOutputBoundary } from "./output_boundary";

export class GetPostInteractor implements GetPostInputBoundary {
  constructor(
    private readonly reader: PostReader,
    private readonly guard: AccessGuard,
    private readonly presenter: GetPostOutputBoundary,
  ) {}

  async execute(input: GetPostInputData): Promise<void> {
    const post = await this.reader.get(input.postId);
    if (post === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    const action = {
      actor: input.actor,
      action: "post.get",
      accountId: post.accountId,
      postId: post.id,
    };
    const allowed = await this.guard.inScope(action);
    this.presenter.present(allowed ? { ok: true, post: toPostView(post) } : refusal("scope"));
  }
}
