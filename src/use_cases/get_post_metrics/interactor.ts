import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { MetricsRepository } from "../ports/metrics_repository";
import type { PostReader } from "../ports/post_reader";
import type { GetPostMetricsInputBoundary } from "./input_boundary";
import type { GetPostMetricsInputData } from "./input_data";
import type { GetPostMetricsOutputBoundary } from "./output_boundary";

export class GetPostMetricsInteractor implements GetPostMetricsInputBoundary {
  constructor(
    private readonly reader: PostReader,
    private readonly metrics: MetricsRepository,
    private readonly guard: AccessGuard,
    private readonly presenter: GetPostMetricsOutputBoundary,
  ) {}

  async execute(input: GetPostMetricsInputData): Promise<void> {
    const post = await this.reader.get(input.postId);
    if (post === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    const action = {
      actor: input.actor,
      action: "metrics.post",
      accountId: post.accountId,
      postId: post.id,
    };
    if (!(await this.guard.inScope(action))) {
      this.presenter.present(refusal("scope"));
      return;
    }
    const ids = post.parts.flatMap((part) =>
      part.state.kind === "SENT" ? [part.state.xPostId] : [],
    );
    const latest = await this.metrics.latest(ids);
    const parts = ids.flatMap((id) => latest.filter((snapshot) => snapshot.xPostId === id));
    this.presenter.present({ ok: true, postId: post.id, parts });
  }
}
