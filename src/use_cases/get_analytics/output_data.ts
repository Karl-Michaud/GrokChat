import type { MetricValues } from "../../entities/analytics/metric_values";
import type { RangeWindow } from "../../entities/analytics/range";
import type { AnalyticsBucket, RankedPost } from "../../entities/analytics/report";
import type { AccountId } from "../../entities/identity/ids";
import type { CostTotals } from "../../entities/records/cost_entry";
import type { Refusal } from "../access/refusal";

/** One period's numbers: the metrics gained, posts published, followers, X spend. */
export interface PeriodTotals {
  readonly values: MetricValues;
  readonly published: number;
  /** Followers gained in the period, summed over the accounts. */
  readonly growth: number;
  readonly spend: CostTotals;
}

export interface AccountBreakdown extends PeriodTotals {
  readonly accountId: AccountId;
  /** The newest follower count known; null before the first snapshot. */
  readonly followers: number | null;
}

export interface Analytics {
  readonly range: RangeWindow;
  readonly current: PeriodTotals;
  /** The period just before; null for all time. */
  readonly previous: PeriodTotals | null;
  /** Followers now, summed over the accounts in scope; null before the first snapshot. */
  readonly followers: number | null;
  readonly buckets: readonly AnalyticsBucket[];
  /** Every account in scope, by id. */
  readonly accounts: readonly AccountBreakdown[];
  readonly topPosts: readonly RankedPost[];
}

/** The analytics page (GROKCHAT-15): human only. */
export type GetAnalyticsOutputData =
  ({ readonly ok: true } & Analytics) | Refusal<"human_only" | "not_found">;
