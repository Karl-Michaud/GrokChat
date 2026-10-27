import { newestPerPost, rankBy } from "../../entities/metrics/metrics_summary";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { MetricsRepository } from "../ports/metrics_repository";
import type { ComparePostsInputBoundary } from "./input_boundary";
import type { ComparePostsInputData } from "./input_data";
import type { ComparePostsOutputBoundary } from "./output_boundary";

export class ComparePostsInteractor implements ComparePostsInputBoundary {
  constructor(
    private readonly metrics: MetricsRepository,
    private readonly guard: AccessGuard,
    private readonly presenter: ComparePostsOutputBoundary,
  ) {}

  async execute(input: ComparePostsInputData): Promise<void> {
    const action = {
      actor: input.actor,
      action: "metrics.compare",
      accountId: input.accountId,
      postId: null,
    };
    if (!(await this.guard.inScope(action))) {
      this.presenter.present(refusal("scope"));
      return;
    }
    const newest = newestPerPost(await this.metrics.series(input.accountId, input.window));
    this.presenter.present({ ok: true, ranked: rankBy(newest, input.sortBy) });
  }
}
