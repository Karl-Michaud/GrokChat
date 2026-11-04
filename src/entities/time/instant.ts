/** A point in time: milliseconds since the Unix epoch, UTC. Entities never read a clock. */
export type Instant = number;

/** A duration in milliseconds. */
export type Millis = number;

export const SECOND: Millis = 1_000;
export const MINUTE: Millis = 60 * SECOND;
export const HOUR: Millis = 60 * MINUTE;
export const DAY: Millis = 24 * HOUR;

/** The local wall-clock fields of an instant in a time zone. */
export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** A half-open window of time, `[from, to)`. */
export interface TimeWindow {
  readonly from: Instant;
  readonly to: Instant;
}

export function inWindow(window: TimeWindow, instant: Instant): boolean {
  return instant >= window.from && instant < window.to;
}
