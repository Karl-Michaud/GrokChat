import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { METRIC_NAMES } from "../../../../src/entities/metrics/metrics_snapshot";
import { METRICS_SCHEDULE, metricsDue } from "../../../../src/entities/metrics/metrics_due";
import { DAY, HOUR, MINUTE } from "../../../../src/entities/time/instant";
import { T0 } from "../../support/builders";

describe("metricsDue", () => {
  it("the decaying schedule: +1 h, +6 h, +24 h, +3 d, +7 d, +29 d", () => {
    expect(METRICS_SCHEDULE).toStrictEqual([HOUR, 6 * HOUR, DAY, 3 * DAY, 7 * DAY, 29 * DAY]);
    expect(METRIC_NAMES).toStrictEqual([
      "impressions",
      "likes",
      "reposts",
      "replies",
      "quotes",
      "bookmarks",
    ]);
  });

  it("not due before the first point; due at it; done once read", () => {
    expect(metricsDue(T0, null, T0 + HOUR - 1)).toBe(false);
    expect(metricsDue(T0, null, T0 + HOUR)).toBe(true);
    expect(metricsDue(T0, T0 + HOUR, T0 + 2 * HOUR)).toBe(false);
    expect(metricsDue(T0, T0 + HOUR - 1, T0 + 2 * HOUR)).toBe(true);
  });

  it("several missed points are caught up by one read", () => {
    expect(metricsDue(T0, T0 + HOUR, T0 + 4 * DAY)).toBe(true);
    expect(metricsDue(T0, T0 + 4 * DAY, T0 + 5 * DAY)).toBe(false);
  });

  it("never due again after the 29-day read", () => {
    expect(metricsDue(T0, T0 + 29 * DAY, T0 + 300 * DAY)).toBe(false);
    expect(metricsDue(T0, T0 + 28 * DAY, T0 + 300 * DAY)).toBe(true);
  });

  it("property: right after any read, nothing is due until the next schedule point", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40 * DAY }),
        fc.integer({ min: 0, max: 40 * DAY }),
        (readAfter, later) => {
          const readAt = T0 + readAfter;
          const now = readAt + later;
          const nextPoint = METRICS_SCHEDULE.map((offset) => T0 + offset).find(
            (point) => point > readAt,
          );
          const expected = nextPoint !== undefined && now >= nextPoint;
          expect(metricsDue(T0, readAt, now)).toBe(expected);
        },
      ),
    );
  });

  it("property: at most six reads over a post's life, however often the tick runs", () => {
    fc.assert(
      fc.property(fc.integer({ min: MINUTE, max: 6 * HOUR }), (tick) => {
        let last: number | null = null;
        let reads = 0;
        for (let now = T0; now <= T0 + 40 * DAY; now += tick) {
          if (metricsDue(T0, last, now)) {
            reads += 1;
            last = now;
          }
        }
        expect(reads).toBeLessThanOrEqual(6);
        expect(reads).toBeGreaterThan(0);
      }),
      { numRuns: 30 },
    );
  });
});
