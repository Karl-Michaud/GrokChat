import type { Account } from "../../entities/accounts/account";
import { engagements, type MetricValues } from "../../entities/analytics/metric_values";
import type { AnalyticsRange, RangeWindow } from "../../entities/analytics/range";
import type { AnalyticsBucket, RankedPost } from "../../entities/analytics/report";
import { DAY } from "../../entities/time/instant";
import type { Analytics, PeriodTotals } from "../../use_cases/get_analytics/output_data";
import { badgeOf, bareHandle, type AccountBadge } from "./account_directory";
import { barRows, lineChart, sparkline, type BarRow, type LineChartView } from "./charts";
import {
  clockLabel,
  compact,
  dayLabel,
  delta,
  dollars,
  exact,
  percent,
  signedCompact,
  type Delta,
} from "./format";
import { postHref, xPostUrl } from "./links";

/** The metrics the analytics chart can show, in the order its tabs list them. */
export type ChartMetric =
  "impressions" | "engagements" | "likes" | "reposts" | "replies" | "linkClicks";

export const CHART_METRICS: readonly ChartMetric[] = [
  "impressions",
  "engagements",
  "likes",
  "reposts",
  "replies",
  "linkClicks",
];

export const METRIC_LABELS: Readonly<Record<ChartMetric, string>> = {
  impressions: "Impressions",
  engagements: "Engagements",
  likes: "Likes",
  reposts: "Reposts",
  replies: "Replies",
  linkClicks: "Link clicks",
};

export const RANGE_LABELS: Readonly<Record<AnalyticsRange, string>> = {
  "24h": "Last 24 hours",
  "3d": "Last 3 days",
  "7d": "Last 7 days",
  "14d": "Last 14 days",
  "30d": "Last 30 days",
  all: "All time",
};

export function metricValue(values: MetricValues, metric: ChartMetric): number {
  return metric === "engagements" ? engagements(values) : values[metric];
}

/**
 * How a KPI's change is coloured: "up-is-good" greens a rise and reds a fall; "neutral" (spend,
 * where a lower bill is not a better result in the same sense) colours neither.
 */
export type KpiPolarity = "up-is-good" | "neutral";

export interface Kpi {
  readonly label: string;
  readonly value: string;
  /** The exact figure, for the tile's title. */
  readonly exact: string;
  readonly delta: Delta | null;
  readonly polarity: KpiPolarity;
  /** The headline tiles' trend over the range, a sparkline path; null for none. */
  readonly spark: string | null;
}

/** The KPI tiles: four headline ones with their trend, then the secondary stats. */
export interface KpiGroups {
  readonly headline: readonly Kpi[];
  readonly secondary: readonly Kpi[];
}

interface KpiInput {
  readonly label: string;
  readonly current: number;
  readonly previous: number | null;
  readonly show?: (value: number) => string;
  readonly polarity?: KpiPolarity;
  readonly series?: readonly (number | null)[];
}

function kpi(input: KpiInput): Kpi {
  return {
    label: input.label,
    value: (input.show ?? compact)(input.current),
    exact: exact(input.current),
    delta: delta(input.current, input.previous),
    polarity: input.polarity ?? "up-is-good",
    spark: input.series === undefined ? null : sparkline(input.series),
  };
}

function metricKpi(
  key: ChartMetric,
  current: PeriodTotals,
  previous: PeriodTotals | null,
  buckets: readonly AnalyticsBucket[] | null,
): Kpi {
  return kpi({
    label: METRIC_LABELS[key],
    current: metricValue(current.values, key),
    previous: previous === null ? null : metricValue(previous.values, key),
    ...(buckets === null
      ? {}
      : { series: buckets.map((bucket) => metricValue(bucket.values, key)) }),
  });
}

/** The KPI tiles: what the period gained, against the period before, the headline ones trended. */
export function kpis(
  current: PeriodTotals,
  previous: PeriodTotals | null,
  buckets: readonly AnalyticsBucket[],
): KpiGroups {
  const secondary = (key: ChartMetric) => metricKpi(key, current, previous, null);
  return {
    headline: [
      metricKpi("impressions", current, previous, buckets),
      metricKpi("engagements", current, previous, buckets),
      kpi({
        label: "Follower growth",
        current: current.growth,
        previous: previous?.growth ?? null,
        show: signedCompact,
        series: buckets.map((bucket) => bucket.followers),
      }),
      kpi({
        label: "Posts published",
        current: current.published,
        previous: previous?.published ?? null,
        series: buckets.map((bucket) => bucket.published),
      }),
    ],
    secondary: [
      ...(["likes", "reposts", "replies", "linkClicks"] as const).map(secondary),
      kpi({
        label: "X spend",
        current: current.spend.micros,
        previous: previous?.spend.micros ?? null,
        show: dollars,
        polarity: "neutral",
      }),
    ],
  };
}

/** Hours for the hourly ranges, days otherwise. */
export function bucketLabel(range: RangeWindow, start: number): string {
  return range.bucket < DAY ? `${dayLabel(start)} ${clockLabel(start)}` : dayLabel(start);
}

export function metricChart(analytics: Analytics, metric: ChartMetric): LineChartView {
  const buckets = analytics.buckets.map((bucket: AnalyticsBucket) => ({
    label: bucketLabel(analytics.range, bucket.start),
    value: metricValue(bucket.values, metric),
  }));
  return lineChart(buckets, exact);
}

export function followersChart(analytics: Analytics): LineChartView {
  const buckets = analytics.buckets.map((bucket) => ({
    label: bucketLabel(analytics.range, bucket.start),
    value: bucket.followers,
  }));
  return lineChart(buckets, exact, false);
}

export interface AccountRow {
  readonly account: AccountBadge;
  readonly href: string;
  readonly impressions: string;
  readonly engagements: string;
  readonly rate: string;
  readonly published: string;
  readonly followers: string;
  readonly growth: string;
  readonly spend: string;
}

const rate = (values: MetricValues): string =>
  values.impressions === 0 ? "—" : percent(engagements(values) / values.impressions);

export function accountRows(
  analytics: Analytics,
  accounts: readonly Account[],
  link: (id: string) => string,
): readonly AccountRow[] {
  return analytics.accounts.map((row) => ({
    account: badgeOf(accounts, row.accountId),
    href: link(row.accountId),
    impressions: compact(row.values.impressions),
    engagements: compact(engagements(row.values)),
    rate: rate(row.values),
    published: exact(row.published),
    followers: row.followers === null ? "—" : compact(row.followers),
    growth: signedCompact(row.growth),
    spend: dollars(row.spend.micros),
  }));
}

/** The chosen metric per account, as bars, longest first. */
export function comparison(
  analytics: Analytics,
  accounts: readonly Account[],
  metric: ChartMetric,
): readonly BarRow[] {
  const rows = analytics.accounts.map((row) => ({
    label: badgeOf(accounts, row.accountId).handle,
    value: metricValue(row.values, metric),
  }));
  return barRows(rows, compact);
}

export interface TopPostRow {
  readonly href: string;
  readonly text: string;
  readonly account: AccountBadge;
  readonly impressions: string;
  readonly engagements: string;
  readonly rate: string;
  readonly xUrl: string;
}

export function topPostRows(
  posts: readonly RankedPost[],
  accounts: readonly Account[],
): readonly TopPostRow[] {
  const handleOf = (post: RankedPost) => bareHandle(accounts, post.accountId);
  return posts.map((post) => ({
    href: postHref(post.postId),
    text: post.text,
    account: badgeOf(accounts, post.accountId),
    impressions: compact(post.values.impressions),
    engagements: compact(engagements(post.values)),
    rate: rate(post.values),
    xUrl: xPostUrl(handleOf(post), post.xPostId),
  }));
}
