import { DAY, MINUTE, type Instant } from "../../entities/time/instant";

/**
 * Form fields and their display. The dashboard shows and takes UTC times. Every parser reads the
 * text, formats the result back and accepts it only when that gives the same text, so anything
 * that is not exactly the expected form (2026-02-30, 24:00, 007, 1e3) is refused.
 */

/** `2026-10-27T12:30`, the value of a datetime-local input. */
export function toDateTimeInput(instant: Instant): string {
  return new Date(instant).toISOString().slice(0, 16);
}

/** `2026-10-27`. */
export function formatUtcDate(instant: Instant): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/** `2026-10-27 12:30 UTC`. */
export function formatUtc(instant: Instant): string {
  return `${toDateTimeInput(instant).replace("T", " ")} UTC`;
}

/** Minutes of the day as `HH:MM`. */
export function formatClock(minuteOfDay: number): string {
  return new Date(minuteOfDay * MINUTE).toISOString().slice(11, 16);
}

function roundTrip(
  text: string,
  iso: string,
  format: (instant: Instant) => string,
): Instant | null {
  const instant = Date.parse(iso);
  return Number.isNaN(instant) || format(instant) !== text ? null : instant;
}

/** `YYYY-MM-DDTHH:MM` (an `<input type="datetime-local">`), read as UTC. */
export function parseUtcDateTime(value: string): Instant | null {
  const text = value.trim();
  return roundTrip(text, `${text}:00Z`, toDateTimeInput);
}

/** `YYYY-MM-DD`, the UTC midnight it starts at. */
export function parseUtcDate(value: string): Instant | null {
  const text = value.trim();
  return roundTrip(text, `${text}T00:00:00Z`, formatUtcDate);
}

/** `HH:MM` as minutes of the day; null when it is not a time of day. */
export function parseClock(value: string): number | null {
  const text = value.trim();
  const instant = roundTrip(text, `1970-01-01T${text}:00Z`, (at) => formatClock(at / MINUTE));
  return instant === null ? null : instant / MINUTE;
}

/** The UTC midnight an instant falls on. */
export function startOfUtcDay(instant: Instant): Instant {
  return Math.floor(instant / DAY) * DAY;
}

/** A whole number of zero or more, written plainly; null otherwise. */
export function parseWhole(value: string): number | null {
  const text = value.trim();
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 0 && String(number) === text ? number : null;
}

/** Whole minutes as milliseconds; null when not a whole number of minutes. */
export function parseMinutes(value: string): number | null {
  const minutes = parseWhole(value);
  return minutes === null ? null : minutes * MINUTE;
}

/** A comma-separated list, trimmed, without empty entries. */
export function parseList(value: string): readonly string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** A query or form value, with an empty one read as absent. */
export function filled(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value.trim();
}
