import type { MetricValues } from "../../entities/analytics/metric_values";
import type { ImportedPost } from "../../entities/posts/imported_post";
import type { Refusal } from "../access/refusal";
import type { PostView } from "../views/post_view";

/** A post with its metrics: the newest read of each of its parts, summed; null when never read. */
export interface PostWithMetrics {
  readonly post: PostView;
  readonly metrics: MetricValues | null;
}

/** A post made outside GrokChat, found on the account's timeline (GROKCHAT-19), with its metrics. */
export interface ImportedWithMetrics {
  readonly imported: ImportedPost;
  readonly metrics: MetricValues | null;
}

/** A row of the posts page: one of GrokChat's posts, or one made outside it. */
export type ListedPost =
  | ({ readonly source: "grokchat" } & PostWithMetrics)
  | ({ readonly source: "x" } & ImportedWithMetrics);

/** The posts page (GROKCHAT-15): human only. */
export type ListPostsOutputData =
  | {
      readonly ok: true;
      readonly rows: readonly ListedPost[];
      /** Posts matching the filter, on every page. */
      readonly total: number;
      readonly page: number;
      readonly pages: number;
    }
  | Refusal<"human_only">;
