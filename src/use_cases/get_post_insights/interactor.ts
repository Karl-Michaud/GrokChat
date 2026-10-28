import { xIdsOf } from "../../entities/analytics/report";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { ActivityLog } from "../ports/activity_log";
import type { MetricsHistory } from "../ports/metrics_history";
import type { PostReader } from "../ports/post_reader";
import { toPostView } from "../views/post_view";
import type { GetPostInsightsInputBoundary } from "./input_boundary";
import type { GetPostInsightsInputData } from "./input_data";
import type { GetPostInsightsOutputBoundary } from "./output_boundary";

export interface GetPostInsightsPorts {
  readonly reader: PostReader;
  readonly metrics: MetricsHistory;
  readonly activity: ActivityLog;
  readonly guard: AccessGuard;
}

/** The newest events a post's timeline shows; a post rarely has a dozen. */
export const TIMELINE_LIMIT = 200;

export class GetPostInsightsInteractor implements GetPostInsightsInputBoundary {
  constructor(
    private readonly ports: GetPostInsightsPorts,
    private readonly presenter: GetPostInsightsOutputBoundary,
  ) {}

  async execute(input: GetPostInsightsInputData): Promise<void> {
    const post = await this.ports.reader.get(input.postId);
    if (post === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    const action = { actor: input.actor, action: "post.insights", accountId: post.accountId };
    if (!(await this.ports.guard.inScope({ ...action, postId: post.id }))) {
      this.presenter.present(refusal("scope"));
      return;
    }
    const series = await this.ports.metrics.postSeries(xIdsOf(post));
    const history = await this.ports.activity.page({ postId: post.id }, 0, TIMELINE_LIMIT);
    this.presenter.present({
      ok: true,
      post: toPostView(post),
      series,
      timeline: [...history.entries].reverse(),
    });
  }
}
