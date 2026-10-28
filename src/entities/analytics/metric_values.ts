import type { MetricsSnapshot } from "../metrics/metrics_snapshot";

/** What the dashboard counts for a post, an account or a period (GROKCHAT-15). */
export interface MetricValues {
  readonly impressions: number;
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
  readonly bookmarks: number;
  /** `non_public_metrics.url_link_clicks`: posts under 30 days only, so 0 when X gave none. */
  readonly linkClicks: number;
  readonly profileClicks: number;
}

export const METRIC_KEYS: readonly (keyof MetricValues)[] = [
  "impressions",
  "likes",
  "reposts",
  "replies",
  "quotes",
  "bookmarks",
  "linkClicks",
  "profileClicks",
];

export const ZERO: MetricValues = {
  impressions: 0,
  likes: 0,
  reposts: 0,
  replies: 0,
  quotes: 0,
  bookmarks: 0,
  linkClicks: 0,
  profileClicks: 0,
};

export function valuesOf(snapshot: MetricsSnapshot): MetricValues {
  return {
    impressions: snapshot.impressions,
    likes: snapshot.likes,
    reposts: snapshot.reposts,
    replies: snapshot.replies,
    quotes: snapshot.quotes,
    bookmarks: snapshot.bookmarks,
    linkClicks: snapshot.urlLinkClicks ?? 0,
    profileClicks: snapshot.userProfileClicks ?? 0,
  };
}

function combine(
  a: MetricValues,
  b: MetricValues,
  op: (x: number, y: number) => number,
): MetricValues {
  return {
    impressions: op(a.impressions, b.impressions),
    likes: op(a.likes, b.likes),
    reposts: op(a.reposts, b.reposts),
    replies: op(a.replies, b.replies),
    quotes: op(a.quotes, b.quotes),
    bookmarks: op(a.bookmarks, b.bookmarks),
    linkClicks: op(a.linkClicks, b.linkClicks),
    profileClicks: op(a.profileClicks, b.profileClicks),
  };
}

export const plus = (a: MetricValues, b: MetricValues): MetricValues =>
  combine(a, b, (x, y) => x + y);

export const minus = (a: MetricValues, b: MetricValues): MetricValues =>
  combine(a, b, (x, y) => x - y);

export const sum = (values: readonly MetricValues[]): MetricValues => values.reduce(plus, ZERO);

/**
 * Engagements: every interaction X counts on the post itself (likes, reposts, replies, quotes,
 * bookmarks) and the clicks on its link and on the profile. Impressions are not engagements.
 */
export function engagements(values: MetricValues): number {
  return (
    values.likes +
    values.reposts +
    values.replies +
    values.quotes +
    values.bookmarks +
    values.linkClicks +
    values.profileClicks
  );
}
