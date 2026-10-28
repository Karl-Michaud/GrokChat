import { DAY, HOUR, MINUTE, SECOND, type Instant } from "../../entities/time/instant";

/** How the dashboard writes numbers and times (GROKCHAT-15). Times are UTC. */

const UNITS: readonly (readonly [number, string])[] = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/** The typographic minus, so a negative number does not read as a hyphen. */
export const MINUS = "−";

const signOf = (value: number): string => (value < 0 ? MINUS : "");

/** 999 · 1.2K · 12.3K · 123K · 1.2M · 3.4B; one decimal under 100 of a unit, none above. */
export function compact(value: number): string {
  const size = Math.abs(value);
  const sign = signOf(value);
  for (const [unit, suffix] of UNITS) {
    if (size >= unit * 0.9995) {
      const scaled = size / unit;
      // Stryker disable next-line EqualityOperator: at exactly 99.95 both roundings print 100.
      const shown = scaled < 99.95 ? Number(scaled.toFixed(1)) : Math.round(scaled);
      return `${sign}${String(shown)}${suffix}`;
    }
  }
  return `${sign}${String(Math.round(size))}`;
}

/** 12,345 */
export function exact(value: number): string {
  return `${signOf(value)}${Math.abs(value).toLocaleString("en-US")}`;
}

/** +1.2K / −34 / 0, for gains. */
export function signedCompact(value: number): string {
  return value > 0 ? `+${compact(value)}` : compact(value);
}

/** A ratio as a percentage: 0.1234 → 12.3%. */
export function percent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/**
 * Micro-dollars: $1.23 from a dollar up; below it, as many decimals as it takes, from two to four
 * (X prices in tenths of a cent: $0.015 a post, $0.30 for twenty).
 */
export function dollars(micros: number): string {
  const amount = micros / 1_000_000;
  // Stryker disable next-line EqualityOperator: exactly $1 prints $1.00 on either branch.
  return `$${amount >= 1 ? amount.toFixed(2) : amount.toFixed(4).replace(/0{1,2}$/, "")}`;
}

export type Direction = "up" | "down" | "flat";

export interface Delta {
  /** +12% / −3% / 0% / new */
  readonly text: string;
  readonly direction: Direction;
}

/** The change against the period before; null when there is none to compare with. */
export function delta(current: number, previous: number | null): Delta | null {
  if (previous === null) {
    return null;
  }
  if (previous === 0) {
    return current === 0 ? { text: "0%", direction: "flat" } : { text: "new", direction: "up" };
  }
  const change = Math.round(((current - previous) / Math.abs(previous)) * 100);
  const sign = Math.sign(change);
  if (sign > 0) {
    return { text: `+${String(change)}%`, direction: "up" };
  }
  return sign < 0
    ? { text: `${MINUS}${String(-change)}%`, direction: "down" }
    : { text: "0%", direction: "flat" };
}

/** Oct 27 */
export function dayLabel(at: Instant): string {
  return new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** 14:05 */
export function clockLabel(at: Instant): string {
  return new Date(at).toISOString().slice(11, 16);
}

/** Oct 27, 14:05 UTC */
export function dateTimeLabel(at: Instant): string {
  return `${dayLabel(at)}, ${clockLabel(at)} UTC`;
}

/** The largest unit that fits; under an hour, minutes. */
const STEPS: readonly (readonly [number, string])[] = [
  [DAY, "d"],
  [HOUR, "h"],
];

/** just now · 5 min ago · 3 h ago · 2 d ago · in 4 h; past 30 days, the date. */
export function relativeTime(at: Instant, now: Instant): string {
  const gap = Math.abs(now - at);
  if (gap < 45 * SECOND) {
    return "just now";
  }
  if (gap >= 30 * DAY) {
    return dayLabel(at);
  }
  const [unit, suffix] = STEPS.find(([size]) => gap >= size) ?? [MINUTE, "min"];
  const amount = `${String(Math.max(1, Math.round(gap / unit)))} ${suffix}`;
  // Stryker disable next-line EqualityOperator: `at === now` is "just now", above.
  return at <= now ? `${amount} ago` : `in ${amount}`;
}
