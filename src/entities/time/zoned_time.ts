import { DAY, MINUTE, SECOND, type Instant, type WallClock } from "./instant";

/** True when the runtime knows the IANA time zone (policy validation, plan §3.1). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Field = "year" | "month" | "day" | "hour" | "minute" | "second";

/** The wall-clock fields of an instant in `tz`. */
export function wallClock(instant: Instant, tz: string): WallClock {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const parts = Object.fromEntries(
    format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  const field = (name: Field): number => Number(parts[name]);
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second"),
  };
}

/** The wall clock of `instant` in `tz`, read as if it were UTC (milliseconds kept). */
export function wallAsUtc(instant: Instant, tz: string): number {
  const w = wallClock(instant, tz);
  const millis = ((instant % SECOND) + SECOND) % SECOND;
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) + millis;
}

/** Minutes since local midnight, 0–1439. */
export function minuteOfDay(instant: Instant, tz: string): number {
  const w = wallClock(instant, tz);
  return w.hour * 60 + w.minute;
}

/** The local calendar day of an instant, `YYYY-MM-DD`: the unit of the daily cap. */
export function localDayKey(instant: Instant, tz: string): string {
  const w = wallClock(instant, tz);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(w.year)}-${pad(w.month)}-${pad(w.day)}`;
}

/**
 * Every instant whose local wall clock equals `wall` (a wall time read as UTC), earliest first:
 * one normally, two in a fall-back overlap. In a spring-forward gap the wall time never occurs,
 * and the result is the instant the clocks jump past it.
 */
export function instantsOfWall(wall: number, tz: string): readonly Instant[] {
  const offsets = [wall - DAY, wall + DAY].map((probe) => wallAsUtc(probe, tz) - probe);
  // Offsets fall back from the earlier to the later probe, so an overlap's two candidates
  // already come earliest first.
  const candidates = [...new Set(offsets.map((offset) => wall - offset))];
  const exact = candidates.filter((candidate) => wallAsUtc(candidate, tz) === wall);
  if (exact.length > 0) {
    return exact;
  }
  return [offsetChange(Math.min(...candidates), Math.max(...candidates), tz)];
}

const offsetAt = (instant: Instant, tz: string): number => wallAsUtc(instant, tz) - instant;

/** Binary search, to the second, for the instant the zone's offset changes in (low, high]. */
function offsetChange(low: Instant, high: Instant, tz: string): Instant {
  const before = offsetAt(low, tz);
  let from = low;
  let to = high;
  while (to - from > SECOND) {
    const middle = from + Math.floor((to - from) / 2 / SECOND) * SECOND;
    if (offsetAt(middle, tz) === before) {
      from = middle;
    } else {
      to = middle;
    }
  }
  return to;
}

/**
 * The first instant after `after` whose wall clock is `minute` minutes past a local midnight.
 * Tomorrow's occurrence is always later than `after`, so the minimum always exists.
 */
export function nextWallMinute(after: Instant, tz: string, minute: number): Instant {
  const w = wallClock(after, tz);
  const today = Date.UTC(w.year, w.month - 1, w.day) + minute * MINUTE;
  const candidates = [...instantsOfWall(today, tz), ...instantsOfWall(today + DAY, tz)];
  return Math.min(...candidates.filter((candidate) => candidate > after));
}
