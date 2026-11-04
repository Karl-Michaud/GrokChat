import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { Refusal } from "../access/refusal";

/** Each post's newest snapshot, best first by the chosen metric. */
export type ComparePostsOutputData =
  { readonly ok: true; readonly ranked: readonly MetricsSnapshot[] } | Refusal<"scope">;
