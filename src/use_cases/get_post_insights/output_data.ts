import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { Refusal } from "../access/refusal";
import type { ActivityEntry } from "../ports/activity_log";
import type { PostView } from "../views/post_view";

/** A post's page (GROKCHAT-15): the post, every metrics read of its parts, and its history. */
export type GetPostInsightsOutputData =
  | {
      readonly ok: true;
      readonly post: PostView;
      /** Every read of every part, oldest first. */
      readonly series: readonly MetricsSnapshot[];
      /** The post's audit events with their costs, oldest first. */
      readonly timeline: readonly ActivityEntry[];
    }
  | Refusal<"not_found" | "scope">;
