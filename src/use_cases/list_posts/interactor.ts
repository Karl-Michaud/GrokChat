import { sum, valuesOf, type MetricValues } from "../../entities/analytics/metric_values";
import { comparePosts, pageOf } from "../../entities/analytics/post_sort";
import { xIdsOf } from "../../entities/analytics/report";
import type { XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import { derivedStatus } from "../../entities/posts/derived_status";
import type { Post } from "../../entities/posts/post";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { MetricsRepository } from "../ports/metrics_repository";
import type { PostFilter, PostReader } from "../ports/post_reader";
import { toPostView } from "../views/post_view";
import type { ListPostsInputBoundary } from "./input_boundary";
import type { ListPostsInputData } from "./input_data";
import type { ListPostsOutputBoundary } from "./output_boundary";
import type { PostWithMetrics } from "./output_data";

export interface ListPostsPorts {
  readonly reader: PostReader;
  readonly metrics: MetricsRepository;
  readonly guard: AccessGuard;
}

function withMetrics(post: Post, latest: ReadonlyMap<XPostId, MetricsSnapshot>): PostWithMetrics {
  const reads = xIdsOf(post).flatMap((id) => {
    const snapshot = latest.get(id);
    return snapshot === undefined ? [] : [valuesOf(snapshot)];
  });
  const metrics: MetricValues | null = reads.length === 0 ? null : sum(reads);
  return { post: toPostView(post), metrics };
}

/**
 * Every post, filtered by account, status and publish time, sorted by time or any metric, one
 * page at a time (GROKCHAT-15). The sort needs every matching post's metrics, so the page is cut
 * after sorting, in memory: one listing query and one metrics query per page view, which holds
 * for v0's thousands of posts (plan §2: about 3,000 a month).
 */
export class ListPostsInteractor implements ListPostsInputBoundary {
  constructor(
    private readonly ports: ListPostsPorts,
    private readonly presenter: ListPostsOutputBoundary,
  ) {}

  async execute(input: ListPostsInputData): Promise<void> {
    const action = { actor: input.actor, action: "post.list", accountId: null, postId: null };
    if (!(await this.ports.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const filter: PostFilter = {
      ...(input.accountId === null ? {} : { accountIds: [input.accountId] }),
      ...(input.window === null ? {} : { publishWindow: input.window }),
    };
    const statuses = input.statuses;
    const posts = (await this.ports.reader.list(filter)).filter(
      (post) => statuses === null || statuses.includes(derivedStatus(post)),
    );
    const latest = await this.ports.metrics.latest(posts.flatMap(xIdsOf));
    const byId = new Map(latest.map((snapshot) => [snapshot.xPostId, snapshot]));
    const rows = posts.map((post) => withMetrics(post, byId));
    const order = comparePosts(input.sort, input.direction);
    rows.sort((a, b) =>
      order(
        { id: a.post.id, publishAt: a.post.publishAt, metrics: a.metrics },
        { id: b.post.id, publishAt: b.post.publishAt, metrics: b.metrics },
      ),
    );
    const { items, page, pages } = pageOf(rows, input.page, input.pageSize);
    this.presenter.present({ ok: true, rows: items, total: rows.length, page, pages });
  }
}
