import type { Account } from "../../entities/accounts/account";
import { followerGrowth, followersAt } from "../../entities/analytics/followers";
import { increments, totalIn, type MetricIncrement } from "../../entities/analytics/increments";
import { rangeWindow, type AnalyticsRange, type RangeWindow } from "../../entities/analytics/range";
import {
  accountTotals,
  bucketSeries,
  publishedAt,
  publishedIn,
  topPosts,
} from "../../entities/analytics/report";
import type { AccountId } from "../../entities/identity/ids";
import type { FollowerSnapshot } from "../../entities/metrics/follower_snapshot";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { Post } from "../../entities/posts/post";
import type { Instant, TimeWindow } from "../../entities/time/instant";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { AccountRepository } from "../ports/account_repository";
import type { Clock } from "../ports/clock";
import type { CostLedger } from "../ports/cost_ledger";
import type { FollowerHistory } from "../ports/follower_history";
import type { MetricsHistory } from "../ports/metrics_history";
import type { PostReader } from "../ports/post_reader";
import type { GetAnalyticsInputBoundary } from "./input_boundary";
import type { GetAnalyticsInputData } from "./input_data";
import type { GetAnalyticsOutputBoundary } from "./output_boundary";
import type { AccountBreakdown, Analytics, PeriodTotals } from "./output_data";

export interface GetAnalyticsPorts {
  readonly accounts: AccountRepository;
  readonly reader: PostReader;
  readonly metrics: MetricsHistory;
  readonly followers: FollowerHistory;
  readonly costs: CostLedger;
  readonly guard: AccessGuard;
  readonly clock: Clock;
}

/** How many posts the top-posts table shows. */
export const TOP_POSTS = 5;

/** What the numbers are computed from, over the range and the period before it. */
interface Loaded {
  readonly range: RangeWindow;
  /** The account asked for; null for every account. */
  readonly scope: AccountId | null;
  readonly accounts: readonly Account[];
  readonly posts: readonly Post[];
  readonly gains: readonly MetricIncrement[];
  readonly followers: readonly FollowerSnapshot[];
}

/** The first instant any data was recorded at; `now` when there is none. */
function earliest(
  now: Instant,
  posts: readonly Post[],
  metrics: readonly MetricsSnapshot[],
  followers: readonly FollowerSnapshot[],
): Instant {
  return Math.min(
    now,
    ...posts.flatMap((post) => publishedAt(post) ?? []),
    ...metrics.map((snapshot) => snapshot.takenAt),
    ...followers.map((snapshot) => snapshot.takenAt),
  );
}

/** Followers now: every account's newest count, whenever it was read. */
const NEWEST = Number.POSITIVE_INFINITY;

/**
 * The analytics of every account or of one (GROKCHAT-15), for a range: the metrics gained, posts
 * published, follower growth and X spend, against the period before; the series by bucket; the
 * per-account breakdown; the top posts. All arithmetic is in the entities (`analytics/`).
 */
export class GetAnalyticsInteractor implements GetAnalyticsInputBoundary {
  constructor(
    private readonly ports: GetAnalyticsPorts,
    private readonly presenter: GetAnalyticsOutputBoundary,
  ) {}

  async execute(input: GetAnalyticsInputData): Promise<void> {
    const action = { actor: input.actor, action: "analytics.get", accountId: null, postId: null };
    if (!(await this.ports.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const loaded = await this.load(input.range, input.accountId);
    if (loaded === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    this.presenter.present({ ok: true, ...(await this.analytics(loaded)) });
  }

  private async load(range: AnalyticsRange, id: AccountId | null): Promise<Loaded | null> {
    const { accounts, reader, metrics, followers, clock } = this.ports;
    const all = await accounts.list();
    const scope = id === null ? all : all.filter((account) => account.id === id);
    if (scope.length === 0 && id !== null) {
      return null;
    }
    const now = clock.now();
    const fixed = range === "all" ? null : rangeWindow(range, now, null);
    // Stryker disable next-line all: reading from further back changes no figure (every one is windowed); this only narrows the read to the range and the period before it.
    const from = fixed?.previous?.from ?? 0;
    const span = { from, to: now + 1 };
    // Stryker disable next-line all: a post never sent adds to no figure; this only narrows the read.
    const filter = { partStates: ["SENT", "DELETED"] as const };
    const posts = await reader.list(id === null ? filter : { ...filter, accountIds: [id] });
    const snapshots = await metrics.history(id, span);
    const counts = await followers.history(id, span);
    const window = fixed ?? rangeWindow("all", now, earliest(now, posts, snapshots, counts));
    return {
      range: window,
      scope: id,
      accounts: scope,
      posts,
      gains: increments(snapshots),
      followers: counts,
    };
  }

  private async analytics(loaded: Loaded): Promise<Analytics> {
    const { range, scope } = loaded;
    const current = await this.period(loaded, range.window, scope);
    const previous =
      range.previous === null ? null : await this.period(loaded, range.previous, scope);
    const accounts: AccountBreakdown[] = [];
    for (const account of loaded.accounts) {
      accounts.push(await this.breakdown(loaded, account.id));
    }
    return {
      range,
      current,
      previous,
      followers: followersAt(loaded.followers, NEWEST),
      buckets: bucketSeries(range, loaded.gains, loaded.followers, loaded.posts),
      accounts,
      topPosts: topPosts(loaded.posts, loaded.gains, range.window, TOP_POSTS),
    };
  }

  private async period(
    loaded: Loaded,
    window: TimeWindow,
    account: AccountId | null,
  ): Promise<PeriodTotals> {
    return {
      values: totalIn(loaded.gains, window),
      published: publishedIn(loaded.posts, window),
      growth: followerGrowth(loaded.followers, window),
      spend: await this.ports.costs.totals(window, account),
    };
  }

  private async breakdown(loaded: Loaded, account: AccountId): Promise<AccountBreakdown> {
    const { window } = loaded.range;
    const own = (item: { readonly accountId: AccountId }) => item.accountId === account;
    const followers = loaded.followers.filter(own);
    return {
      accountId: account,
      values: accountTotals(loaded.gains, account, window),
      published: publishedIn(loaded.posts.filter(own), window),
      growth: followerGrowth(followers, window),
      followers: followersAt(followers, NEWEST),
      spend: await this.ports.costs.totals(window, account),
    };
  }
}
