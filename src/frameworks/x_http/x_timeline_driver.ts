import { xPostId, type AccountId, type XPostId } from "../../entities/identity/ids";
import { MINUTE, SECOND, type Instant, type Millis } from "../../entities/time/instant";
import type { XResult } from "../../entities/x/x_failure";
import type { Clock } from "../../use_cases/ports/clock";
import type {
  XOwnTimelineReader,
  XPostSummary,
  XPostsPage,
} from "../../use_cases/ports/x_own_timeline_reader";
import { field, list, text } from "./json_fields";
import type { XApiClient } from "./x_api_client";
import { FIELDS_PARAM } from "./x_metrics_driver";
import type { XUserDirectory } from "./x_user_directory";

/** X's page size bounds (docs.x.com user-posts-timeline: 5–100). */
export const PAGE_SIZE = 100;
/**
 * The read is bounded to `[since, since + WINDOW)` once that window is over, so the one page holds
 * every post in it: X allows 100 creates per user per 15 minutes, and reconcile's target was
 * attempted a minute after `since` (plan §3.3 #6).
 */
export const WINDOW: Millis = 10 * MINUTE;
/** X refuses an `end_time` that is not safely in the past. */
export const END_TIME_MARGIN: Millis = 10 * SECOND;

/** X's RFC 3339 timestamps, to the second (`2026-10-27T12:00:00Z`). */
export const xTime = (instant: Instant): string =>
  new Date(Math.floor(instant / SECOND) * SECOND).toISOString().replace(".000Z", "Z");

/** The post a reply answers: `referenced_tweets` (the live API) or `referenced_posts` (the spec). */
function repliedTo(post: unknown): XPostId | null {
  const references = [
    ...list(field(post, "referenced_tweets")),
    ...list(field(post, "referenced_posts")),
  ];
  const reply = references.find((reference) => field(reference, "type") === "replied_to");
  const id = text(field(reply, "id"));
  return id === null ? null : xPostId(id);
}

function summary(post: unknown): XPostSummary | null {
  const id = text(field(post, "id"));
  const body = text(field(post, "text"));
  const createdAt = Date.parse(text(field(post, "created_at")) ?? "");
  if (id === null || body === null || Number.isNaN(createdAt)) {
    return null;
  }
  return { id: xPostId(id), text: body, createdAt, inReplyTo: repliedTo(post) };
}

/**
 * `GET /2/users/:id/tweets` with `start_time` (docs.x.com user-posts-timeline). X returns newest
 * first; the port's contract is **the oldest `maxResults` posts created at or after `since`,
 * oldest first** — the posts right after an attempt, which is what reconcile looks for.
 */
export class HttpXOwnTimelineReader implements XOwnTimelineReader {
  constructor(
    private readonly client: XApiClient,
    private readonly users: XUserDirectory,
    private readonly clock: Clock,
  ) {}

  async recent(
    account: AccountId,
    since: Instant,
    maxResults: number,
  ): Promise<XResult<readonly XPostSummary[]>> {
    const user = await this.users.xUserIdOf(account);
    if (user === null) {
      return { ok: false, failure: { kind: "not_sent" } };
    }
    const result = await this.client.call(account, {
      method: "GET",
      path: `/2/users/${encodeURIComponent(user)}/tweets`,
      query: this.query(since),
    });
    if (!result.ok) {
      return result;
    }
    const posts = list(field(result.value, "data"))
      .flatMap((post) => {
        const read = summary(post);
        return read !== null && read.createdAt >= since ? [read] : [];
      })
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return { ok: true, value: posts.slice(0, Math.max(0, maxResults)) };
  }

  async page(
    account: AccountId,
    since: Instant,
    token: string | null,
  ): Promise<XResult<XPostsPage>> {
    const user = await this.users.xUserIdOf(account);
    if (user === null) {
      return { ok: false, failure: { kind: "not_sent" } };
    }
    const result = await this.client.call(account, {
      method: "GET",
      path: `/2/users/${encodeURIComponent(user)}/tweets`,
      query: {
        start_time: xTime(since),
        max_results: String(PAGE_SIZE),
        exclude: "retweets",
        [FIELDS_PARAM]: "created_at,referenced_tweets",
        ...(token === null ? {} : { pagination_token: token }),
      },
    });
    if (!result.ok) {
      return result;
    }
    const posts = list(field(result.value, "data")).flatMap((post) => summary(post) ?? []);
    const next = text(field(field(result.value, "meta"), "next_token"));
    return { ok: true, value: { posts, next } };
  }

  private query(since: Instant): Record<string, string> {
    const end = since + WINDOW;
    return {
      start_time: xTime(since),
      ...(end <= this.clock.now() - END_TIME_MARGIN ? { end_time: xTime(end) } : {}),
      max_results: String(PAGE_SIZE),
      exclude: "retweets",
      [FIELDS_PARAM]: "created_at,referenced_tweets",
    };
  }
}
