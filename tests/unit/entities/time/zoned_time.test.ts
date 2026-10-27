import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DAY, HOUR, MINUTE, SECOND } from "../../../../src/entities/time/instant";
import {
  instantsOfWall,
  isValidTimeZone,
  localDayKey,
  minuteOfDay,
  nextWallMinute,
  wallAsUtc,
  wallClock,
} from "../../../../src/entities/time/zoned_time";
import { instants, ZONES } from "../../support/arbitraries";

describe("wall clock", () => {
  it("reads the local fields", () => {
    // 2026-03-08 06:59:59Z is 01:59:59 EST; one second later the clocks show 03:00:00 EDT.
    expect(wallClock(Date.UTC(2026, 2, 8, 6, 59, 59), "America/New_York")).toStrictEqual({
      year: 2026,
      month: 3,
      day: 8,
      hour: 1,
      minute: 59,
      second: 59,
    });
    expect(wallClock(Date.UTC(2026, 2, 8, 7, 0, 0), "America/New_York").hour).toBe(3);
    expect(wallClock(Date.UTC(2026, 0, 1, 0, 0, 0), "UTC").hour).toBe(0);
  });

  it("wallAsUtc keeps the milliseconds, also before 1970", () => {
    expect(wallAsUtc(Date.UTC(2026, 0, 1, 10, 0, 0, 123), "Asia/Kolkata")).toBe(
      Date.UTC(2026, 0, 1, 15, 30, 0, 123),
    );
    expect(wallAsUtc(-1, "UTC")).toBe(-1);
  });

  it("minuteOfDay and localDayKey", () => {
    const instant = Date.UTC(2026, 9, 27, 23, 30);
    expect(minuteOfDay(instant, "UTC")).toBe(23 * 60 + 30);
    expect(minuteOfDay(instant, "Asia/Tokyo")).toBe(8 * 60 + 30);
    expect(localDayKey(instant, "UTC")).toBe("2026-10-27");
    expect(localDayKey(instant, "Asia/Tokyo")).toBe("2026-10-28");
    expect(localDayKey(Date.UTC(2026, 0, 5), "UTC")).toBe("2026-01-05");
  });

  it("isValidTimeZone", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("instantsOfWall", () => {
  const ny = "America/New_York";

  it("an ordinary wall time maps to one instant", () => {
    expect(instantsOfWall(Date.UTC(2026, 5, 1, 12, 0), ny)).toStrictEqual([
      Date.UTC(2026, 5, 1, 16, 0),
    ]);
  });

  it("a fall-back wall time maps to two instants, earliest first", () => {
    expect(instantsOfWall(Date.UTC(2026, 10, 1, 1, 30), ny)).toStrictEqual([
      Date.UTC(2026, 10, 1, 5, 30),
      Date.UTC(2026, 10, 1, 6, 30),
    ]);
  });

  it("a spring-forward wall time maps to the instant the clocks jump", () => {
    expect(instantsOfWall(Date.UTC(2026, 2, 8, 2, 30), ny)).toStrictEqual([
      Date.UTC(2026, 2, 8, 7, 0),
    ]);
  });

  it("property: every result reads back as the wall time, or is the first instant past a gap", () => {
    fc.assert(
      fc.property(instants, fc.constantFrom(...ZONES), (instant, tz) => {
        const wall = Math.floor(wallAsUtc(instant, tz) / MINUTE) * MINUTE;
        const found = instantsOfWall(wall, tz);
        for (const candidate of found) {
          expect(wallAsUtc(candidate, tz)).toBe(wall);
        }
        expect(found.length).toBeGreaterThan(0);
      }),
    );
  });

  it("property: in a gap the result is the first second whose wall clock reaches it", () => {
    const gaps = [
      [Date.UTC(2026, 2, 8, 2, 30), "America/New_York"],
      [Date.UTC(2026, 2, 29, 1, 15), "Europe/London"],
      [Date.UTC(2026, 9, 4, 2, 45), "Australia/Sydney"],
      [Date.UTC(2026, 8, 6, 0, 30), "America/Santiago"],
    ] as const;
    for (const [wall, tz] of gaps) {
      const [jump] = instantsOfWall(wall, tz);
      expect(jump).toBeDefined();
      expect(wallAsUtc(jump ?? 0, tz)).toBeGreaterThanOrEqual(wall);
      expect(wallAsUtc((jump ?? 0) - SECOND, tz)).toBeLessThan(wall);
    }
  });
});

describe("nextWallMinute", () => {
  it("later today, or tomorrow when the minute has passed", () => {
    const now = Date.UTC(2026, 9, 27, 12, 0);
    expect(nextWallMinute(now, "UTC", 13 * 60)).toBe(Date.UTC(2026, 9, 27, 13, 0));
    expect(nextWallMinute(now, "UTC", 12 * 60)).toBe(Date.UTC(2026, 9, 28, 12, 0));
    expect(nextWallMinute(now, "UTC", 0)).toBe(Date.UTC(2026, 9, 28, 0, 0));
  });

  it("property: strictly later, on the minute asked for (or just past a gap), and the first one", () => {
    fc.assert(
      fc.property(
        instants,
        fc.constantFrom(...ZONES),
        fc.integer({ min: 0, max: 1439 }),
        (now, tz, minute) => {
          const next = nextWallMinute(now, tz, minute);
          expect(next).toBeGreaterThan(now);
          expect(next - now).toBeLessThanOrEqual(DAY + 2 * HOUR);
          const onTime = minuteOfDay(next, tz) === minute;
          const pastGap = wallAsUtc(next, tz) - wallAsUtc(next - SECOND, tz) > SECOND;
          expect(onTime || pastGap).toBe(true);
          for (let probe = next - MINUTE; probe > now; probe -= MINUTE) {
            expect(minuteOfDay(probe, tz)).not.toBe(minute);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
