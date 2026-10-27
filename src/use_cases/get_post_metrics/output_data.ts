import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { PostId } from "../../entities/identity/ids";
import type { Refusal } from "../access/refusal";

/** The newest snapshot of each sent part, in part order. */
export type GetPostMetricsOutputData =
  | { readonly ok: true; readonly postId: PostId; readonly parts: readonly MetricsSnapshot[] }
  | Refusal<"not_found" | "scope">;
