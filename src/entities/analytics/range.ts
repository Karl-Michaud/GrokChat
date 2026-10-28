import { DAY, HOUR, type Instant, type Millis, type TimeWindow } from "../time/instant";

/** The dashboard's analytics ranges (GROKCHAT-15). */
export type AnalyticsRange = "24h" | "3d" | "7d" | "14d" | "30d" | "all";

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = ["24h", "3d", "7d", "14d", "30d", "all"];

export const WEEK: Millis = 7 * DAY;

/** "All time" is drawn by day up to this many days, by week beyond (about four months). */
export const ALL_TIME_DAILY_LIMIT = 120;

/** Where a range starts and ends, the period before it, and the buckets its charts use. */
export interface RangeWindow {
  readonly range: AnalyticsRange;
  /** `[from, to)`: from the start of the first bucket to now. */
  readonly window: TimeWindow;
  /** The same length just before `window`, for the deltas; null for all time. */
  readonly previous: TimeWindow | null;
  readonly bucket: Millis;
  /** The start of every bucket, oldest first; the last one holds `now`. */
  readonly starts: readonly Instant[];
}

const FIXED: Readonly<Record<Exclude<AnalyticsRange, "all">, readonly [Millis, number]>> = {
  "24h": [HOUR, 24],
  "3d": [HOUR, 72],
  "7d": [DAY, 7],
  "14d": [DAY, 14],
  "30d": [DAY, 30],
};

const floorTo = (instant: Instant, step: Millis): Instant => Math.floor(instant / step) * step;

function buckets(first: Instant, bucket: Millis, count: number): readonly Instant[] {
  return Array.from({ length: count }, (_, index) => first + index * bucket);
}

/**
 * A range over UTC-aligned buckets: hourly for 24h and 3d, daily for 7d to 30d. All time starts
 * on the UTC day of the earliest data (today when there is none), by day up to
 * `ALL_TIME_DAILY_LIMIT` days and by week beyond, and has no previous period.
 */
export function rangeWindow(
  range: AnalyticsRange,
  now: Instant,
  earliest: Instant | null,
): RangeWindow {
  if (range === "all") {
    return allTime(now, earliest);
  }
  const [bucket, count] = FIXED[range];
  const first = floorTo(now, bucket) - (count - 1) * bucket;
  const length = now - first;
  return {
    range,
    window: { from: first, to: now },
    previous: { from: first - length, to: first },
    bucket,
    starts: buckets(first, bucket, count),
  };
}

function allTime(now: Instant, earliest: Instant | null): RangeWindow {
  const today = floorTo(now, DAY);
  const first = Math.min(floorTo(earliest ?? now, DAY), today);
  const days = (today - first) / DAY + 1;
  const bucket = days <= ALL_TIME_DAILY_LIMIT ? DAY : WEEK;
  const count = Math.floor((today - first) / bucket) + 1;
  return {
    range: "all",
    window: { from: first, to: now },
    previous: null,
    bucket,
    starts: buckets(first, bucket, count),
  };
}
