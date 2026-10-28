import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { utcDay } from "../../../../src/entities/metrics/follower_snapshot";
import { DAY } from "../../../../src/entities/time/instant";

describe("utcDay (GROKCHAT-15)", () => {
  it("is the UTC calendar day, YYYY-MM-DD", () => {
    expect(utcDay(Date.UTC(2026, 9, 27, 0, 0, 0))).toBe("2026-10-27");
    expect(utcDay(Date.UTC(2026, 9, 27, 23, 59, 59, 999))).toBe("2026-10-27");
    expect(utcDay(Date.UTC(2026, 9, 28))).toBe("2026-10-28");
  });

  it("property: every instant of a UTC day maps to that day, and the next day differs", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50_000 }), fc.nat({ max: DAY - 1 }), (day, offset) => {
        const start = day * DAY;
        expect(utcDay(start + offset)).toBe(utcDay(start));
        expect(utcDay(start + DAY)).not.toBe(utcDay(start));
        expect(utcDay(start)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }),
    );
  });
});
