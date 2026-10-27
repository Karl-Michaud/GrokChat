import { metricTotals, newestPerPost } from "../../entities/metrics/metrics_summary";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { MetricsRepository } from "../ports/metrics_repository";
import type { GetAccountMetricsInputBoundary } from "./input_boundary";
import type { GetAccountMetricsInputData } from "./input_data";
import type { GetAccountMetricsOutputBoundary } from "./output_boundary";

export class GetAccountMetricsInteractor implements GetAccountMetricsInputBoundary {
  constructor(
    private readonly metrics: MetricsRepository,
    private readonly guard: AccessGuard,
    private readonly presenter: GetAccountMetricsOutputBoundary,
  ) {}

  async execute(input: GetAccountMetricsInputData): Promise<void> {
    const action = {
      actor: input.actor,
      action: "metrics.account",
      accountId: input.accountId,
      postId: null,
    };
    if (!(await this.guard.inScope(action))) {
      this.presenter.present(refusal("scope"));
      return;
    }
    const series = await this.metrics.series(input.accountId, input.window);
    const newest = newestPerPost(series);
    this.presenter.present({
      ok: true,
      accountId: input.accountId,
      posts: newest.length,
      totals: metricTotals(newest),
      series,
    });
  }
}
