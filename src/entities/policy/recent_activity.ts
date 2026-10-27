import type { PostId } from "../identity/ids";
import type { Instant } from "../time/instant";
import { attemptTime } from "../posts/part_state";
import type { Post } from "../posts/post";

/** A post with a part SENDING, SENT or UNKNOWN: its first and last send attempt. */
export interface PostActivity {
  readonly postId: PostId;
  readonly firstAt: Instant;
  readonly lastAt: Instant;
}

/** What the cap and the gap are counted over (in-flight posts count; rev 4 M5, N1). */
export interface RecentActivity {
  readonly posts: readonly PostActivity[];
}

export function activityOf(posts: readonly Post[]): RecentActivity {
  const activity = posts.flatMap((post) => {
    const times = post.parts
      .map((part) => attemptTime(part.state))
      .filter((time): time is Instant => time !== null);
    return times.length === 0
      ? []
      : [{ postId: post.id, firstAt: Math.min(...times), lastAt: Math.max(...times) }];
  });
  return { posts: activity };
}
