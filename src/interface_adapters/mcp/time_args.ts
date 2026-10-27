import type { Instant, TimeWindow } from "../../entities/time/instant";

/**
 * An ISO 8601 time the boundary schema has already checked carries an offset (m5), as an instant.
 * Absent stays null.
 */
export function instantArg(iso: string | undefined): Instant | null {
  return iso === undefined ? null : Date.parse(iso);
}

/** An open end of a listing window. */
const EARLIEST: Instant = 0;
const LATEST: Instant = Number.MAX_SAFE_INTEGER;

/** `[from, to)`; a missing end is open; both missing: no window. */
export function optionalWindow(
  from: string | undefined,
  to: string | undefined,
): TimeWindow | null {
  if (from === undefined && to === undefined) {
    return null;
  }
  return { from: instantArg(from) ?? EARLIEST, to: instantArg(to) ?? LATEST };
}

export function windowArg(from: string, to: string): TimeWindow {
  return { from: Date.parse(from), to: Date.parse(to) };
}
