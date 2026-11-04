import type { MetricValues } from "../../entities/analytics/metric_values";
import type { Refusal } from "../access/refusal";
import type { PostView } from "../views/post_view";

/** A post with its metrics: the newest read of each of its parts, summed; null when never read. */
export interface PostWithMetrics {
  readonly post: PostView;
  readonly metrics: MetricValues | null;
}

/** The posts page (GROKCHAT-15): human only. */
export type ListPostsOutputData =
  | {
      readonly ok: true;
      readonly rows: readonly PostWithMetrics[];
      /** Posts matching the filter, on every page. */
      readonly total: number;
      readonly page: number;
      readonly pages: number;
    }
  | Refusal<"human_only">;
