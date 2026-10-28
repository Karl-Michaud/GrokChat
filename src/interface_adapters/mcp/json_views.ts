import type { Account } from "../../entities/accounts/account";
import type { PostingPolicy } from "../../entities/accounts/posting_policy";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { Instant } from "../../entities/time/instant";
import type { PostView } from "../../use_cases/views/post_view";
import type { JsonObject } from "./tool_result";

/** Instants leave GrokChat as ISO 8601 UTC strings. */
export function isoTime(instant: Instant): string {
  return new Date(instant).toISOString();
}

const MINUTE_MS = 60_000;

export function postJson(post: PostView): JsonObject {
  return {
    post_id: post.id,
    account_id: post.accountId,
    status: post.status,
    lifecycle: post.lifecycle,
    publish_at: isoTime(post.publishAt),
    resume_at: post.resumeAt === null ? null : isoTime(post.resumeAt),
    parts: post.parts.map((part) => ({
      text: part.text,
      state: part.state,
      x_post_id: part.xPostId,
    })),
    created_by: post.createdBy,
    version: post.version,
  };
}

export function snapshotJson(snapshot: MetricsSnapshot): JsonObject {
  return {
    x_post_id: snapshot.xPostId,
    account_id: snapshot.accountId,
    taken_at: isoTime(snapshot.takenAt),
    impressions: snapshot.impressions,
    likes: snapshot.likes,
    reposts: snapshot.reposts,
    replies: snapshot.replies,
    quotes: snapshot.quotes,
    bookmarks: snapshot.bookmarks,
    url_link_clicks: snapshot.urlLinkClicks,
    user_profile_clicks: snapshot.userProfileClicks,
  };
}

/** Durations in whole minutes, quiet hours as `HH:MM` local times: what a bot plans with. */
export function policyJson(policy: PostingPolicy): JsonObject {
  const clock = (minute: number): string =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return {
    mode: policy.mode,
    daily_cap: policy.dailyCap,
    min_gap_minutes: policy.minGap / MINUTE_MS,
    quiet_hours:
      policy.quietHours === null
        ? null
        : { start: clock(policy.quietHours.startMinute), end: clock(policy.quietHours.endMinute) },
    time_zone: policy.tz,
    link_policy: policy.linkPolicy,
    grace_minutes: policy.grace / MINUTE_MS,
  };
}

export function disclosureJson(disclosure: Account["disclosure"]): JsonObject {
  return {
    bio_confirmed: disclosure.bioConfirmed,
    automated_label_confirmed: disclosure.automatedLabelConfirmed,
  };
}
