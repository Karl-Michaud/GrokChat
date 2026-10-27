import { ALLOWED, refuse, type Decision } from "../decision";
import type { Instant } from "../time/instant";

/** This month's R2 use, tracked in D1 (plan §3.5: never exceed the free tier). */
export interface MediaUsage {
  readonly month: string;
  readonly storedBytes: number;
  readonly classA: number;
  readonly classB: number;
}

/** Guards set below the free allowance of 10 GB, 1M Class A and 10M Class B a month (U17). */
export const R2_GUARDS = {
  storedBytes: 8_000_000_000,
  classA: 800_000,
  classB: 8_000_000,
} as const;

/** The UTC month an instant falls in, `YYYY-MM`: R2 operations are counted per month. */
export function monthKey(now: Instant): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** The usage as of `now`: a new month starts the operation counts again; stored bytes stay. */
export function usageAt(usage: MediaUsage, now: Instant): MediaUsage {
  const month = monthKey(now);
  return usage.month === month
    ? usage
    : { month, storedBytes: usage.storedBytes, classA: 0, classB: 0 };
}

/** An upload is one Class A write that adds `bytes` to what is stored. */
export function canStore(usage: MediaUsage, bytes: number, now: Instant): Decision<"media_quota"> {
  const current = usageAt(usage, now);
  const full = current.storedBytes + bytes > R2_GUARDS.storedBytes;
  return full || current.classA >= R2_GUARDS.classA ? refuse("media_quota") : ALLOWED;
}

/** A read is one Class B operation. */
export function canRead(usage: MediaUsage, now: Instant): Decision<"media_quota"> {
  return usageAt(usage, now).classB >= R2_GUARDS.classB ? refuse("media_quota") : ALLOWED;
}
