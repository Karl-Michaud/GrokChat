import type { Account } from "../../entities/accounts/account";
import type { PostSortKey, SortDirection } from "../../entities/analytics/post_sort";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import type { Instant } from "../../entities/time/instant";
import type {
  ImportedWithMetrics,
  ListedPost,
  PostWithMetrics,
} from "../../use_cases/list_posts/output_data";
import { badgeOf, bareHandle, type AccountBadge } from "./account_directory";
import { postStatusChip, type Chip } from "./chips";
import { dateTimeLabel, relativeTime } from "./format";
import { liveUrl, postHref, xPostUrl } from "./links";
import { metricCells, type MetricCells } from "./metric_cells";

/** Every status the posts page filters by, in the order the filter lists them. */
export const STATUS_OPTIONS: readonly DerivedStatus[] = [
  "PENDING_REVIEW",
  "SCHEDULED",
  "PUBLISHING",
  "RESUMING",
  "PUBLISHED",
  "PARTIALLY_PUBLISHED",
  "UNKNOWN_OUTCOME",
  "NOT_FOUND",
  "FAILED",
  "MISSED",
  "DRAFT",
  "CANCELLED",
  "DELETED",
  "DELETE_INCOMPLETE",
];

export interface PostListRow {
  /** GrokChat's page for its own post; the post on X for one made outside GrokChat. */
  readonly href: string;
  readonly account: AccountBadge;
  readonly status: Chip;
  readonly text: string;
  readonly parts: number;
  readonly when: string;
  readonly relative: string;
  readonly metrics: MetricCells;
  /** The first part on X; null before it is sent. */
  readonly xUrl: string | null;
}

/** A post made outside GrokChat (GROKCHAT-19): there is no GrokChat page, so it links to X. */
export const POSTED_ON_X: Chip = { label: "Posted on X", tone: "neutral" };

export function postListRow(
  row: ListedPost,
  accounts: readonly Account[],
  now: Instant,
): PostListRow {
  return row.source === "grokchat" ? ownRow(row, accounts, now) : importedRow(row, accounts, now);
}

function importedRow(
  row: ImportedWithMetrics,
  accounts: readonly Account[],
  now: Instant,
): PostListRow {
  const { imported } = row;
  const url = xPostUrl(bareHandle(accounts, imported.accountId), imported.xPostId);
  return {
    href: url,
    account: badgeOf(accounts, imported.accountId),
    status: POSTED_ON_X,
    text: imported.text,
    parts: 1,
    when: dateTimeLabel(imported.createdAt),
    relative: relativeTime(imported.createdAt, now),
    metrics: metricCells(row.metrics),
    xUrl: url,
  };
}

function ownRow(row: PostWithMetrics, accounts: readonly Account[], now: Instant): PostListRow {
  const { post } = row;
  const first = post.parts[0];
  return {
    href: postHref(post.id),
    account: badgeOf(accounts, post.accountId),
    status: postStatusChip(post.status),
    text: first?.text ?? "",
    parts: post.parts.length,
    when: dateTimeLabel(post.publishAt),
    relative: relativeTime(post.publishAt, now),
    metrics: metricCells(row.metrics),
    xUrl: first === undefined ? null : liveUrl(bareHandle(accounts, post.accountId), first),
  };
}

export interface SortColumn {
  readonly key: PostSortKey;
  readonly label: string;
  readonly href: string;
  /** The column the page is sorted by, and which way; null for the others. */
  readonly sorted: SortDirection | null;
}

export const SORT_LABELS: Readonly<Record<PostSortKey, string>> = {
  time: "Publish time",
  impressions: "Impressions",
  engagements: "Engagements",
  likes: "Likes",
  reposts: "Reposts",
  replies: "Replies",
  linkClicks: "Link clicks",
};

/** A column's link sorts by it, descending first; the sorted column's link flips its direction. */
export function sortColumns(
  keys: readonly PostSortKey[],
  current: PostSortKey,
  direction: SortDirection,
  link: (key: PostSortKey, direction: SortDirection) => string,
): readonly SortColumn[] {
  return keys.map((key) => {
    const sorted = key === current ? direction : null;
    const next: SortDirection = sorted === "desc" ? "asc" : "desc";
    return { key, label: SORT_LABELS[key], href: link(key, next), sorted };
  });
}
