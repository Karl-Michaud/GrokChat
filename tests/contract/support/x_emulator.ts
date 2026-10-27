/**
 * A small X API emulator behind `FixtureTransport`, so the contract suites can run the fetch
 * drivers against X's documented behaviour: `start_time`/`end_time` filtering and newest-first
 * order on the user timeline, ids that are not found reported in `errors`, created ids.
 */
import type { Instant } from "../../../src/entities/time/instant";
import type { TransportResult } from "../../../src/frameworks/x_http/transport";
import type { SeenRequest } from "./x_fixtures";
import { respond } from "./x_fixtures";

export interface EmulatedPost {
  readonly id: string;
  readonly text: string;
  readonly createdAt: Instant;
  readonly inReplyTo: string | null;
}

const PUBLIC = {
  retweet_count: 2,
  reply_count: 1,
  like_count: 10,
  quote_count: 0,
  bookmark_count: 3,
  impression_count: 100,
};

export class XEmulator {
  readonly posts = new Map<string, EmulatedPost>();
  private next = 1_850_000_000_000_000_000n;

  constructor(private readonly now: () => Instant) {}

  newId(): string {
    this.next += 1n;
    return this.next.toString();
  }

  readonly handle = (request: SeenRequest): TransportResult => {
    const path = request.url.pathname;
    if (request.method === "POST" && path === "/2/tweets") {
      return this.create(request);
    }
    if (request.method === "DELETE" && path.startsWith("/2/tweets/")) {
      this.posts.delete(path.slice("/2/tweets/".length));
      return respond(200, { data: { deleted: true } });
    }
    if (request.method === "GET" && path === "/2/tweets") {
      return this.lookup(request.url.searchParams.get("ids") ?? "");
    }
    if (request.method === "GET" && /^\/2\/users\/[^/]+\/tweets$/.test(path)) {
      return this.timeline(request.url.searchParams);
    }
    return this.media(request);
  };

  private create(request: SeenRequest): TransportResult {
    const body = JSON.parse(request.body) as {
      text: string;
      reply?: { in_reply_to_tweet_id: string };
    };
    const id = this.newId();
    this.posts.set(id, {
      id,
      text: body.text,
      createdAt: this.now(),
      inReplyTo: body.reply?.in_reply_to_tweet_id ?? null,
    });
    return respond(201, { data: { id, text: body.text, edit_history_tweet_ids: [id] } });
  }

  private lookup(ids: string): TransportResult {
    const wanted = ids.split(",");
    const found = wanted.filter((id) => this.posts.has(id));
    const missing = wanted.filter((id) => !this.posts.has(id));
    return respond(200, {
      data: found.map((id) => ({
        id,
        text: this.posts.get(id)?.text,
        edit_history_tweet_ids: [id],
        public_metrics: PUBLIC,
        non_public_metrics: { impression_count: 100, url_link_clicks: 5, user_profile_clicks: 4 },
      })),
      ...(missing.length > 0
        ? {
            errors: missing.map((id) => ({
              value: id,
              detail: `Could not find tweet with ids: [${id}].`,
              title: "Not Found Error",
              resource_type: "tweet",
              parameter: "ids",
              resource_id: id,
              type: "https://api.x.com/2/problems/resource-not-found",
            })),
          }
        : {}),
    });
  }

  private timeline(query: URLSearchParams): TransportResult {
    const start = Date.parse(query.get("start_time") ?? "1970-01-01T00:00:00Z");
    const endParam = query.get("end_time");
    const end = endParam === null ? Number.POSITIVE_INFINITY : Date.parse(endParam);
    const max = Number(query.get("max_results") ?? "10");
    const page = [...this.posts.values()]
      .filter((post) => post.createdAt >= start && post.createdAt < end)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, max);
    if (page.length === 0) {
      return respond(200, { meta: { result_count: 0 } });
    }
    return respond(200, {
      data: page.map((post) => ({
        id: post.id,
        text: post.text,
        created_at: new Date(post.createdAt).toISOString(),
        edit_history_tweet_ids: [post.id],
        ...(post.inReplyTo === null
          ? {}
          : { referenced_tweets: [{ type: "replied_to", id: post.inReplyTo }] }),
      })),
      meta: {
        result_count: page.length,
        newest_id: page[0]?.id,
        oldest_id: page.at(-1)?.id,
      },
    });
  }

  private media(request: SeenRequest): TransportResult {
    const path = request.url.pathname;
    if (path.endsWith("/append")) {
      return { kind: "response", response: new Response(null, { status: 204 }) };
    }
    const id = path.endsWith("/finalize")
      ? (path.split("/")[4] ?? "")
      : (request.url.searchParams.get("media_id") ?? this.newId());
    return respond(200, {
      data: { id, media_key: `16_${id}`, size: 3, expires_after_secs: 86400 },
    });
  }
}
