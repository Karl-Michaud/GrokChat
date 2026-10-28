import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ALL_TIME_DAILY_LIMIT,
  ANALYTICS_RANGES,
  rangeWindow,
  WEEK,
} from "../../../../src/entities/analytics/range";
import { DAY, HOUR } from "../../../../src/entities/time/instant";
import { T0 } from "../../support/builders";

const NOW = T0 + 30 * 60_000;

describe("analytics ranges (GROKCHAT-15)", () => {
  it("lists the six ranges in order", () => {
    expect(ANALYTICS_RANGES).toStrictEqual(["24h", "3d", "7d", "14d", "30d", "all"]);
  });

  it.each([
    ["24h", HOUR, 24],
    ["3d", HOUR, 72],
    ["7d", DAY, 7],
    ["14d", DAY, 14],
    ["30d", DAY, 30],
  ] as const)(
    "%s: %d ms buckets, %d of them, ending with the one holding now",
    (range, bucket, n) => {
      const found = rangeWindow(range, NOW, null);
      const last = Math.floor(NOW / bucket) * bucket;
      expect(found.bucket).toBe(bucket);
      expect(found.starts).toHaveLength(n);
      expect(found.starts.at(-1)).toBe(last);
      expect(found.window).toStrictEqual({ from: last - (n - 1) * bucket, to: NOW + 1 });
      const length = NOW + 1 - found.window.from;
      expect(found.previous).toStrictEqual({
        from: found.window.from - length,
        to: found.window.from,
      });
    },
  );

  it("24h starts on the hour 23 hours before this one", () => {
    expect(rangeWindow("24h", NOW, null).window.from).toBe(Date.UTC(2026, 9, 26, 13));
    expect(rangeWindow("7d", NOW, null).window.from).toBe(Date.UTC(2026, 9, 21));
  });

  it("all time: from the earliest day to now included, daily up to the limit, weekly beyond, no previous", () => {
    const today = Math.floor(NOW / DAY) * DAY;
    const none = rangeWindow("all", NOW, null);
    expect(none.window).toStrictEqual({ from: today, to: NOW + 1 });
    expect([none.range, none.starts, none.previous, none.bucket]).toStrictEqual([
      "all",
      [today],
      null,
      DAY,
    ]);
    const daily = rangeWindow("all", NOW, today - (ALL_TIME_DAILY_LIMIT - 1) * DAY + 5);
    expect([daily.bucket, daily.starts.length]).toStrictEqual([DAY, ALL_TIME_DAILY_LIMIT]);
    const weekly = rangeWindow("all", NOW, today - ALL_TIME_DAILY_LIMIT * DAY);
    expect(weekly.bucket).toBe(WEEK);
    expect(weekly.window.from).toBe(today - ALL_TIME_DAILY_LIMIT * DAY);
    expect(weekly.starts).toHaveLength(Math.floor(ALL_TIME_DAILY_LIMIT / 7) + 1);
    expect(rangeWindow("all", NOW, NOW + DAY).starts).toStrictEqual([today]);
  });

  it("property: buckets are contiguous from the window's start, and the last holds now", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ANALYTICS_RANGES),
        fc.integer({ min: T0, max: T0 + 400 * DAY }),
        fc.option(fc.integer({ min: T0 - 400 * DAY, max: T0 }), { nil: null }),
        (range, now, earliest) => {
          const found = rangeWindow(range, now, earliest);
          expect(found.window.from).toBe(found.starts[0]);
          found.starts.forEach((start, index) => {
            expect(start).toBe(found.window.from + index * found.bucket);
          });
          const last = found.starts.at(-1) ?? 0;
          expect(now >= last && now < last + found.bucket).toBe(true);
          expect(found.range).toBe(range);
        },
      ),
    );
  });
});
