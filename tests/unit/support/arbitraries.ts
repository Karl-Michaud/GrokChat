/** fast-check generators shared by the property tests. */
import fc from "fast-check";

/** Zones with DST in both hemispheres, a half-hour zone, one that changes at midnight, and UTC. */
export const ZONES = [
  "UTC",
  "America/New_York",
  "Europe/London",
  "Europe/Paris",
  "Australia/Sydney",
  "Asia/Kolkata",
  "America/Santiago",
  "Pacific/Chatham",
  "Asia/Tokyo",
] as const;

/** 2020–2030: plenty of DST transitions in every zone above. */
export const instants = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) });
