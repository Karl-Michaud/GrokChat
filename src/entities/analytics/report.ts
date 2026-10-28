import type { AccountId, PostId, XPostId } from "../identity/ids";
import type { FollowerSnapshot } from "../metrics/follower_snapshot";
import type { Post } from "../posts/post";
import type { Instant, TimeWindow } from "../time/instant";
import { inWindow } from "../time/instant";
import { followersAt } from "./followers";
import type { MetricIncrement } from "./increments";
import { perPost, totalIn } from "./increments";
import { engagements, sum, type MetricValues } from "./metric_values";
import type { RangeWindow } from "./range";

/** One bucket of the analytics charts (GROKCHAT-15). */
export interface AnalyticsBucket {
  readonly start: Instant;
  readonly values: MetricValues;
  /** Followers summed over the accounts at the bucket's end; null before any is known. */
  readonly followers: number | null;
  readonly published: number;
}

/** A post's place in the top posts: its gains inside the window. */
export interface RankedPost {
  readonly postId: PostId;
  readonly accountId: AccountId;
  /** Every part's text, in order. */
  readonly text: string;
  /** The first of its parts that gained in the window, for the link to X. */
  readonly xPostId: XPostId;
  readonly publishedAt: Instant | null;
  readonly values: MetricValues;
}

/** When the post's first part went up; null when it never did or its time is gone (deleted). */
export function publishedAt(post: Post): Instant | null {
  const first = post.parts[0]?.state;
  return first?.kind === "SENT" ? first.at : null;
}

/** Every X id the post has or had: its sent and deleted parts. */
export function xIdsOf(post: Post): readonly XPostId[] {
  return post.parts.flatMap((part) =>
    part.state.kind === "SENT" || part.state.kind === "DELETED" ? [part.state.xPostId] : [],
  );
}

export function publishedIn(posts: readonly Post[], window: TimeWindow): number {
  return posts.filter((post) => {
    const at = publishedAt(post);
    return at !== null && inWindow(window, at);
  }).length;
}

export function bucketSeries(
  range: RangeWindow,
  found: readonly MetricIncrement[],
  followers: readonly FollowerSnapshot[],
  posts: readonly Post[],
): readonly AnalyticsBucket[] {
  return range.starts.map((start) => {
    const bucket = { from: start, to: start + range.bucket };
    return {
      start,
      values: totalIn(found, bucket),
      followers: followersAt(followers, bucket.to),
      published: publishedIn(posts, bucket),
    };
  });
}

/** Best first by engagements, then impressions, then post id; at most `limit`. */
export function topPosts(
  posts: readonly Post[],
  found: readonly MetricIncrement[],
  window: TimeWindow,
  limit: number,
): readonly RankedPost[] {
  const gains = perPost(found, window);
  const ranked = posts.flatMap((post): RankedPost[] => {
    const gained = xIdsOf(post).flatMap((id) => {
      const values = gains.get(id);
      return values === undefined ? [] : [{ id, values }];
    });
    const [lead] = gained;
    return lead === undefined
      ? []
      : [
          {
            postId: post.id,
            accountId: post.accountId,
            text: post.parts.map((part) => part.text).join(" "),
            xPostId: lead.id,
            publishedAt: publishedAt(post),
            values: sum(gained.map((item) => item.values)),
          },
        ];
  });
  return ranked
    .sort(
      (a, b) =>
        engagements(b.values) - engagements(a.values) ||
        b.values.impressions - a.values.impressions ||
        a.postId.localeCompare(b.postId),
    )
    .slice(0, limit);
}

/** The gains of one account's posts inside the window. */
export function accountTotals(
  found: readonly MetricIncrement[],
  account: AccountId,
  window: TimeWindow,
): MetricValues {
  return sum(
    found
      .filter((item) => item.accountId === account && inWindow(window, item.at))
      .map((item) => item.values),
  );
}
