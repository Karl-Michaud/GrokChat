import { DAY, HOUR, type Instant, type Millis } from "../time/instant";

/** Six reads per post on a decaying schedule; the last before X's 30-day limit (rev 4 §2). */
export const METRICS_SCHEDULE: readonly Millis[] = [
  HOUR,
  6 * HOUR,
  DAY,
  3 * DAY,
  7 * DAY,
  29 * DAY,
];

/**
 * Due when the latest schedule point that has passed has no read at or after it. A missed point
 * is caught up by one read, never several.
 */
export function metricsDue(
  publishedAt: Instant,
  lastTakenAt: Instant | null,
  now: Instant,
): boolean {
  const passed = METRICS_SCHEDULE.filter((offset) => publishedAt + offset <= now);
  // With no point passed yet, the latest point is −∞ and nothing is due.
  const latestPoint = publishedAt + Math.max(...passed);
  return (lastTakenAt ?? Number.NEGATIVE_INFINITY) < latestPoint;
}
