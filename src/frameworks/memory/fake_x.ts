import type { MediaKind } from "../../entities/content/staged_media";
import {
  xMediaId,
  xPostId,
  type AccountId,
  type XMediaId,
  type XPostId,
} from "../../entities/identity/ids";
import type { UserPublicMetrics } from "../../entities/metrics/follower_snapshot";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { Instant } from "../../entities/time/instant";
import type { XFailure, XResult } from "../../entities/x/x_failure";
import type { Clock } from "../../use_cases/ports/clock";
import type { XMediaUploader } from "../../use_cases/ports/x_media_uploader";
import type { XMetricsReader } from "../../use_cases/ports/x_metrics_reader";
import type {
  XOwnTimelineReader,
  XPostSummary,
  XPostsPage,
} from "../../use_cases/ports/x_own_timeline_reader";
import type { XPublisher } from "../../use_cases/ports/x_publisher";
import type { XUserMetricsReader } from "../../use_cases/ports/x_user_metrics_reader";

/** A post that exists on X. */
export interface XPost extends XPostSummary {
  readonly account: AccountId;
  readonly media: readonly XMediaId[];
}

/**
 * What the next call does. `created_no_response` is a post X created whose response was lost:
 * the case reconcile exists for.
 */
export type XScript =
  | { readonly kind: "ok" }
  | { readonly kind: "fail"; readonly failure: XFailure }
  | { readonly kind: "created_no_response" };

/** X as the fakes share it: the posts on it, and scripted outcomes per operation. */
export class FakeXWorld {
  readonly posts = new Map<XPostId, XPost>();
  readonly scripts: Record<
    "create" | "delete" | "upload" | "timeline" | "metrics" | "users",
    XScript[]
  > = {
    create: [],
    delete: [],
    upload: [],
    timeline: [],
    metrics: [],
    users: [],
  };
  /** Runs before every create reaches X (the R4 test asserts the part is SENDING here). */
  beforeCreate: (account: AccountId, text: string) => Promise<void> = () => Promise.resolve();
  /** The timeline's page size (X's is 100); tests lower it to see paging. */
  pageSize = 100;
  private next = 0;

  constructor(readonly clock: Clock) {}

  take(operation: keyof FakeXWorld["scripts"]): XScript {
    return this.scripts[operation].shift() ?? { kind: "ok" };
  }

  newId(prefix: string): string {
    this.next += 1;
    return `${prefix}-${String(this.next)}`;
  }

  postsBy(account: AccountId): readonly XPost[] {
    return [...this.posts.values()].filter((post) => post.account === account);
  }
}

const failed = <T>(failure: XFailure): XResult<T> => ({ ok: false, failure });

export class FakeXPublisher implements XPublisher {
  constructor(private readonly world: FakeXWorld) {}

  async create(
    account: AccountId,
    text: string,
    media: readonly XMediaId[],
    inReplyTo: XPostId | null,
  ): Promise<XResult<XPostId>> {
    const script = this.world.take("create");
    if (script.kind === "fail" && script.failure.kind === "not_sent") {
      return failed(script.failure);
    }
    await this.world.beforeCreate(account, text);
    if (script.kind === "fail") {
      return failed(script.failure);
    }
    const id = xPostId(this.world.newId("x"));
    this.world.posts.set(id, {
      id,
      account,
      text,
      media,
      inReplyTo,
      createdAt: this.world.clock.now(),
    });
    return script.kind === "ok" ? { ok: true, value: id } : failed({ kind: "no_response" });
  }

  delete(account: AccountId, id: XPostId): Promise<XResult<null>> {
    const script = this.world.take("delete");
    if (script.kind === "fail") {
      return Promise.resolve(failed(script.failure));
    }
    this.world.posts.delete(id);
    return Promise.resolve({ ok: true, value: null });
  }
}

export class FakeXMediaUploader implements XMediaUploader {
  readonly uploads: {
    readonly account: AccountId;
    readonly size: number;
    readonly kind: MediaKind;
  }[] = [];

  constructor(private readonly world: FakeXWorld) {}

  upload(account: AccountId, bytes: Uint8Array, kind: MediaKind): Promise<XResult<XMediaId>> {
    const script = this.world.take("upload");
    if (script.kind === "fail") {
      return Promise.resolve(failed(script.failure));
    }
    this.uploads.push({ account, size: bytes.length, kind });
    return Promise.resolve({ ok: true, value: xMediaId(this.world.newId("m")) });
  }
}

export class FakeXTimeline implements XOwnTimelineReader {
  constructor(private readonly world: FakeXWorld) {}

  recent(
    account: AccountId,
    since: Instant,
    maxResults: number,
  ): Promise<XResult<readonly XPostSummary[]>> {
    const script = this.world.take("timeline");
    if (script.kind === "fail") {
      return Promise.resolve(failed(script.failure));
    }
    const posts = this.world
      .postsBy(account)
      .filter((post) => post.createdAt >= since)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, maxResults)
      .map(({ id, text, createdAt, inReplyTo }) => ({ id, text, createdAt, inReplyTo }));
    return Promise.resolve({ ok: true, value: posts });
  }

  /** Pages of `pageSize` (X's is 100), newest first; the token is the next page's offset. */
  page(account: AccountId, since: Instant, token: string | null): Promise<XResult<XPostsPage>> {
    const script = this.world.take("timeline");
    if (script.kind === "fail") {
      return Promise.resolve(failed(script.failure));
    }
    const all = this.world
      .postsBy(account)
      .filter((post) => post.createdAt >= since)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    const start = token === null ? 0 : Number(token);
    const end = start + this.world.pageSize;
    const posts = all
      .slice(start, end)
      .map(({ id, text, createdAt, inReplyTo }) => ({ id, text, createdAt, inReplyTo }));
    return Promise.resolve({
      ok: true,
      value: { posts, next: end < all.length ? String(end) : null },
    });
  }
}

/** X reads at most 100 posts per call; more is refused before anything is sent. */
const MAX_METRICS_IDS = 100;

export class FakeXMetrics implements XMetricsReader {
  constructor(private readonly world: FakeXWorld) {}

  read(account: AccountId, ids: readonly XPostId[]): Promise<XResult<readonly MetricsSnapshot[]>> {
    if (ids.length > MAX_METRICS_IDS) {
      return Promise.resolve(failed({ kind: "not_sent" }));
    }
    if (ids.length === 0) {
      return Promise.resolve({ ok: true, value: [] });
    }
    const script = this.world.take("metrics");
    if (script.kind === "fail") {
      return Promise.resolve(failed(script.failure));
    }
    const takenAt = this.world.clock.now();
    const snapshots = ids
      .filter((id) => this.world.posts.has(id))
      .map((id) => ({
        xPostId: id,
        accountId: account,
        takenAt,
        impressions: 100,
        likes: 10,
        reposts: 2,
        replies: 1,
        quotes: 0,
        bookmarks: 3,
        urlLinkClicks: null,
        userProfileClicks: 4,
      }));
    return Promise.resolve({ ok: true, value: snapshots });
  }
}

/** The account's follower counts on X; `followers` per account, 100 when not set. */
export class FakeXUserMetrics implements XUserMetricsReader {
  readonly followers = new Map<AccountId, number>();
  /** Every account a read reached X for, in order. */
  readonly reads: AccountId[] = [];

  constructor(private readonly world: FakeXWorld) {}

  read(account: AccountId): Promise<XResult<UserPublicMetrics>> {
    const script = this.world.take("users");
    if (script.kind === "fail") {
      return Promise.resolve(failed(script.failure));
    }
    this.reads.push(account);
    const followers = this.followers.get(account) ?? 100;
    return Promise.resolve({ ok: true, value: { followers, following: 5, posts: 12, listed: 1 } });
  }
}
