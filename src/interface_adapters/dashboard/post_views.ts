import type { Account } from "../../entities/accounts/account";
import { sum, valuesOf } from "../../entities/analytics/metric_values";
import type { XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import type { Lifecycle } from "../../entities/posts/post";
import type { Instant } from "../../entities/time/instant";
import type { ActivityEntry } from "../../use_cases/ports/activity_log";
import type { PostView } from "../../use_cases/views/post_view";
import { badgeOf, bareHandle, type AccountBadge } from "./account_directory";
import { activityRow, type ActivityRow } from "./activity_views";
import { lineChart, type LineChartView } from "./charts";
import { partStateChip, postStatusChip, type Chip } from "./chips";
import { dateTimeLabel, exact, relativeTime } from "./format";
import { toDateTimeInput } from "./form_values";
import { liveUrl } from "./links";
import { metricCells, type MetricCells } from "./metric_cells";

export interface PartDetail {
  /** 1-based, as the page shows it. */
  readonly number: number;
  readonly text: string;
  /** The staged media ids, comma-separated, carried through an edit. */
  readonly media: string;
  readonly state: Chip;
  readonly xUrl: string | null;
}

/** What the post page offers; the use cases still decide (§3.1.1). */
export interface PostActions {
  readonly edit: boolean;
  readonly approve: boolean;
  readonly reject: boolean;
  readonly cancel: boolean;
  readonly delete: boolean;
  readonly reschedule: boolean;
  readonly confirmNotOnX: boolean;
}

export interface PostDetailView {
  readonly id: string;
  readonly account: AccountBadge;
  readonly status: Chip;
  readonly derived: DerivedStatus;
  readonly lifecycle: Lifecycle;
  readonly publishAt: string;
  readonly publishRelative: string;
  readonly publishAtInput: string;
  readonly resumeAt: string | null;
  readonly createdBy: string;
  readonly version: number;
  readonly parts: readonly PartDetail[];
  readonly actions: PostActions;
  /** The parts' newest reads, summed; every cell "—" before the first read. */
  readonly totals: MetricCells;
  /** Impressions over time, summed over the parts, one point per read. */
  readonly chart: LineChartView;
  readonly reads: number;
  readonly timeline: readonly ActivityRow[];
}

const UNSTARTED: readonly Lifecycle[] = ["DRAFT", "PENDING_REVIEW", "SCHEDULED"];
const DELETABLE: readonly DerivedStatus[] = [
  "PUBLISHED",
  "PARTIALLY_PUBLISHED",
  "DELETE_INCOMPLETE",
];
const RESCHEDULABLE: readonly DerivedStatus[] = ["FAILED", "MISSED", "NOT_FOUND"];

export function postActions(post: PostView): PostActions {
  const unstarted =
    UNSTARTED.includes(post.lifecycle) && post.parts.every((part) => part.state === "PENDING");
  const inReview = post.lifecycle === "PENDING_REVIEW";
  return {
    edit: unstarted,
    approve: inReview,
    reject: inReview,
    cancel: unstarted || post.lifecycle === "RESUMING",
    delete: DELETABLE.includes(post.status),
    reschedule: RESCHEDULABLE.includes(post.status),
    confirmNotOnX: post.status === "NOT_FOUND",
  };
}

/** At each read, the post's impressions: every part's newest read so far, summed. */
export function impressionsOverTime(
  series: readonly MetricsSnapshot[],
): readonly { readonly at: Instant; readonly value: number }[] {
  const latest = new Map<XPostId, number>();
  const points: { at: Instant; value: number }[] = [];
  for (const snapshot of series) {
    latest.set(snapshot.xPostId, snapshot.impressions);
    const value = [...latest.values()].reduce((total, count) => total + count, 0);
    if (points.at(-1)?.at === snapshot.takenAt) {
      points.pop();
    }
    points.push({ at: snapshot.takenAt, value });
  }
  return points;
}

function newestTotals(series: readonly MetricsSnapshot[]): MetricCells {
  const newest = new Map(series.map((snapshot) => [snapshot.xPostId, snapshot]));
  return metricCells(newest.size === 0 ? null : sum([...newest.values()].map(valuesOf)));
}

export interface PostInsights {
  readonly post: PostView;
  readonly series: readonly MetricsSnapshot[];
  readonly timeline: readonly ActivityEntry[];
}

export function postDetail(
  found: PostInsights,
  accounts: readonly Account[],
  now: Instant,
): PostDetailView {
  const { post, series } = found;
  const handle = bareHandle(accounts, post.accountId);
  const points = impressionsOverTime(series).map((point) => ({
    label: dateTimeLabel(point.at),
    value: point.value,
  }));
  return {
    id: post.id,
    account: badgeOf(accounts, post.accountId),
    status: postStatusChip(post.status),
    derived: post.status,
    lifecycle: post.lifecycle,
    publishAt: dateTimeLabel(post.publishAt),
    publishRelative: relativeTime(post.publishAt, now),
    publishAtInput: toDateTimeInput(post.publishAt),
    resumeAt: post.resumeAt === null ? null : dateTimeLabel(post.resumeAt),
    createdBy: post.createdBy,
    version: post.version,
    parts: post.parts.map((part, index) => ({
      number: index + 1,
      text: part.text,
      media: part.media.join(","),
      state: partStateChip(part.state),
      xUrl: liveUrl(handle, part),
    })),
    actions: postActions(post),
    totals: newestTotals(series),
    chart: lineChart(points, exact),
    reads: series.length,
    timeline: found.timeline.map((entry) => activityRow(entry, accounts, now)),
  };
}
