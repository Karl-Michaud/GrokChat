import type { PostId } from "../identity/ids";
import type { Instant } from "../time/instant";
import { engagements, type MetricValues } from "./metric_values";

/** What the posts page sorts by (GROKCHAT-15). */
export type PostSortKey =
  "time" | "impressions" | "engagements" | "likes" | "reposts" | "replies" | "linkClicks";

export const POST_SORT_KEYS: readonly PostSortKey[] = [
  "time",
  "impressions",
  "engagements",
  "likes",
  "reposts",
  "replies",
  "linkClicks",
];

export type SortDirection = "asc" | "desc";

/** A post as it is sorted: its time and its metrics (null: never read). */
export interface Sortable {
  readonly id: PostId;
  readonly publishAt: Instant;
  readonly metrics: MetricValues | null;
}

function metric(item: Sortable, key: Exclude<PostSortKey, "time">): number | null {
  if (item.metrics === null) {
    return null;
  }
  return key === "engagements" ? engagements(item.metrics) : item.metrics[key];
}

/**
 * A total order for the posts page: by the key in the direction asked, posts never read last
 * whichever the direction, then newest first, then by id, so every page is stable.
 */
export function comparePosts(key: PostSortKey, direction: SortDirection) {
  const sign = direction === "asc" ? 1 : -1;
  return (a: Sortable, b: Sortable): number => {
    const byKey = key === "time" ? sign * (a.publishAt - b.publishAt) : byMetric(a, b, key, sign);
    return byKey || b.publishAt - a.publishAt || a.id.localeCompare(b.id);
  };
}

function byMetric(
  a: Sortable,
  b: Sortable,
  key: Exclude<PostSortKey, "time">,
  sign: number,
): number {
  const x = metric(a, key);
  const y = metric(b, key);
  if (x === null || y === null) {
    return (x === null ? 1 : 0) - (y === null ? 1 : 0);
  }
  return sign * (x - y);
}

/** One page of a list, 1-based, and how many pages there are (at least one). */
export function pageOf<T>(
  items: readonly T[],
  page: number,
  size: number,
): { readonly items: readonly T[]; readonly page: number; readonly pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { items: items.slice((current - 1) * size, current * size), page: current, pages };
}
