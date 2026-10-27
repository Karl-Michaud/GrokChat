import type { Account } from "../../entities/accounts/account";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import type { Lifecycle } from "../../entities/posts/post";
import type { PostView } from "../../use_cases/views/post_view";
import { handleOf } from "./account_directory";
import { formatUtc, toDateTimeInput } from "./form_values";

/** Every status the backlog can be filtered by, in the order the filter lists them. */
export const STATUS_OPTIONS: readonly DerivedStatus[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "SCHEDULED",
  "RESUMING",
  "PUBLISHING",
  "PUBLISHED",
  "PARTIALLY_PUBLISHED",
  "UNKNOWN_OUTCOME",
  "NOT_FOUND",
  "FAILED",
  "MISSED",
  "CANCELLED",
  "DELETED",
  "DELETE_INCOMPLETE",
];

export interface PostRow {
  readonly id: string;
  readonly href: string;
  readonly account: string;
  readonly status: DerivedStatus;
  readonly publishAt: string;
  readonly time: string;
  readonly text: string;
  readonly parts: number;
}

export interface PartDetail {
  /** 1-based, as the page shows it. */
  readonly number: number;
  readonly text: string;
  /** The staged media ids, comma-separated, carried through an edit. */
  readonly media: string;
  readonly state: string;
  readonly xPostId: string | null;
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

export interface MetricsRow {
  readonly xPostId: string;
  readonly takenAt: string;
  readonly impressions: number;
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
  readonly bookmarks: number;
}

export interface PostDetailView {
  readonly id: string;
  readonly account: string;
  readonly status: DerivedStatus;
  readonly lifecycle: Lifecycle;
  readonly publishAt: string;
  readonly publishAtInput: string;
  readonly resumeAt: string | null;
  readonly createdBy: string;
  readonly version: number;
  readonly parts: readonly PartDetail[];
  readonly actions: PostActions;
  readonly metrics: readonly MetricsRow[];
}

export function postHref(id: string): string {
  return `/dashboard/posts/${encodeURIComponent(id)}`;
}

export function postRow(post: PostView, accounts: readonly Account[]): PostRow {
  return {
    id: post.id,
    href: postHref(post.id),
    account: handleOf(accounts, post.accountId),
    status: post.status,
    publishAt: formatUtc(post.publishAt),
    time: toDateTimeInput(post.publishAt).slice(11),
    text: post.parts[0]?.text ?? "",
    parts: post.parts.length,
  };
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

export function metricsRow(snapshot: MetricsSnapshot): MetricsRow {
  return {
    xPostId: snapshot.xPostId,
    takenAt: formatUtc(snapshot.takenAt),
    impressions: snapshot.impressions,
    likes: snapshot.likes,
    reposts: snapshot.reposts,
    replies: snapshot.replies,
    quotes: snapshot.quotes,
    bookmarks: snapshot.bookmarks,
  };
}

export function postDetail(
  post: PostView,
  accounts: readonly Account[],
  metrics: readonly MetricsSnapshot[],
): PostDetailView {
  return {
    id: post.id,
    account: handleOf(accounts, post.accountId),
    status: post.status,
    lifecycle: post.lifecycle,
    publishAt: formatUtc(post.publishAt),
    publishAtInput: toDateTimeInput(post.publishAt),
    resumeAt: post.resumeAt === null ? null : formatUtc(post.resumeAt),
    createdBy: post.createdBy,
    version: post.version,
    parts: post.parts.map((part, index) => ({
      number: index + 1,
      text: part.text,
      media: part.media.join(","),
      state: part.state,
      xPostId: part.xPostId,
    })),
    actions: postActions(post),
    metrics: metrics.map(metricsRow),
  };
}
