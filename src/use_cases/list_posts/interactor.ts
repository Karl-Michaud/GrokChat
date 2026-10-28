import { sum, valuesOf, type MetricValues } from "../../entities/analytics/metric_values";
import { comparePosts, pageOf } from "../../entities/analytics/post_sort";
import { xIdsOf } from "../../entities/analytics/report";
import type { XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import { derivedStatus } from "../../entities/posts/derived_status";
import type { ImportedPost } from "../../entities/posts/imported_post";
import type { Post } from "../../entities/posts/post";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { ImportedPostFilter, ImportedPostStore } from "../ports/imported_posts";
import type { MetricsRepository } from "../ports/metrics_repository";
import type { PostFilter, PostReader } from "../ports/post_reader";
import { toPostView } from "../views/post_view";
import type { ListPostsInputBoundary } from "./input_boundary";
import type { ListPostsInputData } from "./input_data";
import type { ListPostsOutputBoundary } from "./output_boundary";
import type { ListedPost } from "./output_data";

export interface ListPostsPorts {
  readonly reader: PostReader;
  readonly metrics: MetricsRepository;
  readonly imported: ImportedPostStore;
  readonly guard: AccessGuard;
}

type Latest = ReadonlyMap<XPostId, MetricsSnapshot>;

function withMetrics(post: Post, latest: Latest): ListedPost {
  const reads = xIdsOf(post).flatMap((id) => {
    const snapshot = latest.get(id);
    return snapshot === undefined ? [] : [valuesOf(snapshot)];
  });
  const metrics: MetricValues | null = reads.length === 0 ? null : sum(reads);
  return { source: "grokchat", post: toPostView(post), metrics };
}

function importedWithMetrics(imported: ImportedPost, latest: Latest): ListedPost {
  const snapshot = latest.get(imported.xPostId);
  return { source: "x", imported, metrics: snapshot === undefined ? null : valuesOf(snapshot) };
}

/** How a row sorts: by its post's id and publish time, or by when X says it was made. */
function sortable(row: ListedPost) {
  return row.source === "grokchat"
    ? { id: row.post.id, publishAt: row.post.publishAt, metrics: row.metrics }
    : { id: row.imported.xPostId, publishAt: row.imported.createdAt, metrics: row.metrics };
}

/**
 * Every post, filtered by account, status and publish time, sorted by time or any metric, one
 * page at a time (GROKCHAT-15); posts made outside GrokChat (GROKCHAT-19) count as published.
 * The sort needs every matching post's metrics, so the page is cut after sorting, in memory: one
 * listing query (and one for imported posts) and one metrics query per page view, which holds for
 * v0's thousands of posts (plan §2: about 3,000 a month).
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
    const imported =
      statuses === null || statuses.includes("PUBLISHED")
        ? await this.ports.imported.list(importedFilter(input))
        : [];
    const ids = [...posts.flatMap(xIdsOf), ...imported.map((post) => post.xPostId)];
    const latest = await this.ports.metrics.latest(ids);
    const byId = new Map(latest.map((snapshot) => [snapshot.xPostId, snapshot]));
    const rows = [
      ...posts.map((post) => withMetrics(post, byId)),
      ...imported.map((post) => importedWithMetrics(post, byId)),
    ];
    const order = comparePosts(input.sort, input.direction);
    rows.sort((a, b) => order(sortable(a), sortable(b)));
    const { items, page, pages } = pageOf(rows, input.page, input.pageSize);
    this.presenter.present({ ok: true, rows: items, total: rows.length, page, pages });
  }
}

function importedFilter(input: ListPostsInputData): ImportedPostFilter {
  return {
    ...(input.accountId === null ? {} : { accountIds: [input.accountId] }),
    ...(input.window === null ? {} : { createdWindow: input.window }),
  };
}
