import type { AccountId, XPostId } from "../identity/ids";
import type { Instant } from "../time/instant";

/** One read of a post's metrics (`public_metrics` + `non_public_metrics`, plan §1.1). */
export interface MetricsSnapshot {
  readonly xPostId: XPostId;
  readonly accountId: AccountId;
  readonly takenAt: Instant;
  readonly impressions: number;
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
  readonly bookmarks: number;
  readonly urlLinkClicks: number | null;
  readonly userProfileClicks: number | null;
}

export type MetricName = "impressions" | "likes" | "reposts" | "replies" | "quotes" | "bookmarks";

export const METRIC_NAMES: readonly MetricName[] = [
  "impressions",
  "likes",
  "reposts",
  "replies",
  "quotes",
  "bookmarks",
];
