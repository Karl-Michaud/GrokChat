import type { Account } from "../../entities/accounts/account";
import { engagements, type MetricValues } from "../../entities/analytics/metric_values";
import type { AnalyticsRange, RangeWindow } from "../../entities/analytics/range";
import type { AnalyticsBucket, RankedPost } from "../../entities/analytics/report";
import { DAY } from "../../entities/time/instant";
import type { Analytics, PeriodTotals } from "../../use_cases/get_analytics/output_data";
import { badgeOf, bareHandle, type AccountBadge } from "./account_directory";
import { barRows, lineChart, type BarRow, type LineChartView } from "./charts";
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

export interface Kpi {
  readonly label: string;
  readonly value: string;
  /** The exact figure, for the tile's title. */
  readonly exact: string;
  readonly delta: Delta | null;
  /** Whether going up is good (spend: no), so the delta is coloured by what it means. */
  readonly upIsGood: boolean;
}

function kpi(
  label: string,
  current: number,
  previous: number | null,
  show: (value: number) => string = compact,
  upIsGood = true,
): Kpi {
  return {
    label,
    value: show(current),
    exact: exact(current),
    delta: delta(current, previous),
    upIsGood,
  };
}

/** The KPI row: what the period gained, against the period before. */
export function kpis(current: PeriodTotals, previous: PeriodTotals | null): readonly Kpi[] {
  const metric = (key: ChartMetric) =>
    kpi(
      METRIC_LABELS[key],
      metricValue(current.values, key),
      previous === null ? null : metricValue(previous.values, key),
    );
  return [
    metric("impressions"),
    metric("engagements"),
    metric("likes"),
    metric("reposts"),
    metric("replies"),
    metric("linkClicks"),
    kpi("Follower growth", current.growth, previous?.growth ?? null, signedCompact),
    kpi("Posts published", current.published, previous?.published ?? null),
    kpi("X spend", current.spend.micros, previous?.spend.micros ?? null, dollars, false),
  ];
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
