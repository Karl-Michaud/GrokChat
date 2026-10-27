import { xPostId, type AccountId, type XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { Instant } from "../../entities/time/instant";
import type { XResult } from "../../entities/x/x_failure";
import type { Clock } from "../../use_cases/ports/clock";
import type { XMetricsReader } from "../../use_cases/ports/x_metrics_reader";
import { count, field, list, text } from "./json_fields";
import type { XApiClient } from "./x_api_client";

/** `GET /2/tweets` takes at most 100 ids (docs.x.com get-posts-by-ids). */
export const MAX_IDS = 100;

/**
 * The fields parameter. docs.x.com's current OpenAPI spells it `post.fields`; the long-standing
 * `tweet.fields` is what the live API is known to accept, and the `live` suite checks it (PR 4).
 */
export const FIELDS_PARAM = "tweet.fields";

/** A count X renamed (`retweet_count` → `repost_count`): either spelling is read. */
const firstCount = (value: unknown, ...keys: readonly string[]): number | null =>
  keys.map((key) => count(field(value, key))).find((found) => found !== null) ?? null;

function snapshot(post: unknown, account: AccountId, takenAt: Instant): MetricsSnapshot | null {
  const id = text(field(post, "id"));
  const open = field(post, "public_metrics");
  if (id === null || open === null) {
    return null;
  }
  const closed = field(post, "non_public_metrics");
  return {
    xPostId: xPostId(id),
    accountId: account,
    takenAt,
    impressions: firstCount(open, "impression_count") ?? 0,
    likes: firstCount(open, "like_count") ?? 0,
    reposts: firstCount(open, "repost_count", "retweet_count") ?? 0,
    replies: firstCount(open, "reply_count") ?? 0,
    quotes: firstCount(open, "quote_count") ?? 0,
    bookmarks: firstCount(open, "bookmark_count") ?? 0,
    urlLinkClicks: firstCount(closed, "url_link_clicks"),
    userProfileClicks: firstCount(closed, "user_profile_clicks"),
  };
}

/**
 * `public_metrics` and `non_public_metrics` (user context, posts under 30 days) for ≤ 100 posts in
 * one call (plan §3.3 #8). Posts X does not return (deleted, or reported in `errors`) are left out.
 * More than 100 ids is refused before anything is sent.
 */
export class HttpXMetricsReader implements XMetricsReader {
  constructor(
    private readonly client: XApiClient,
    private readonly clock: Clock,
  ) {}

  async read(
    account: AccountId,
    xPostIds: readonly XPostId[],
  ): Promise<XResult<readonly MetricsSnapshot[]>> {
    if (xPostIds.length > MAX_IDS) {
      return { ok: false, failure: { kind: "not_sent" } };
    }
    if (xPostIds.length === 0) {
      return { ok: true, value: [] };
    }
    const result = await this.client.call(account, {
      method: "GET",
      path: "/2/tweets",
      query: { ids: xPostIds.join(","), [FIELDS_PARAM]: "public_metrics,non_public_metrics" },
    });
    if (!result.ok) {
      return result;
    }
    const takenAt = this.clock.now();
    const snapshots = list(field(result.value, "data")).flatMap((post) => {
      const read = snapshot(post, account, takenAt);
      return read === null ? [] : [read];
    });
    return { ok: true, value: snapshots };
  }
}
