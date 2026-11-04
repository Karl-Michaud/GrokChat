import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DAY, HOUR, MINUTE, SECOND } from "../../../../src/entities/time/instant";
import {
  clockLabel,
  compact,
  dateTimeLabel,
  dayLabel,
  delta,
  dollars,
  exact,
  fileSize,
  MINUS,
  percent,
  relativeTime,
  signedCompact,
} from "../../../../src/interface_adapters/dashboard/format";
import { T0 } from "../../support/builders";

describe("numbers (GROKCHAT-15)", () => {
  it.each([
    [0, "0"],
    [7.4, "7"],
    [999, "999"],
    [999.4, "999"],
    [999.6, "1K"],
    [1_000, "1K"],
    [1_234, "1.2K"],
    [12_345, "12.3K"],
    [99_949, "99.9K"],
    [99_950, "100K"],
    [123_456, "123K"],
    [999_499, "999K"],
    [999_500, "1M"],
    [1_234_567, "1.2M"],
    [3_400_000_000, "3.4B"],
    [-1_234, `${MINUS}1.2K`],
    [-12, `${MINUS}12`],
  ])("compact(%d) = %s", (value, text) => {
    expect(compact(value)).toBe(text);
  });

  it("exact, signed and percent", () => {
    expect([exact(12_345), exact(-3), exact(0)]).toStrictEqual(["12,345", `${MINUS}3`, "0"]);
    expect([signedCompact(1_200), signedCompact(0), signedCompact(-5)]).toStrictEqual([
      "+1.2K",
      "0",
      `${MINUS}5`,
    ]);
    expect([percent(0.1234), percent(1), percent(0.5, 0)]).toStrictEqual([
      "12.3%",
      "100.0%",
      "50%",
    ]);
  });

  it.each([
    [0, "$0.00"],
    [10_000, "$0.01"],
    [15_000, "$0.015"],
    [1_500, "$0.0015"],
    [300_000, "$0.30"],
    [115_000, "$0.115"],
    [999_999, "$1.00"],
    [1_000_000, "$1.00"],
    [12_345_678, "$12.35"],
  ])("dollars(%d micros) = %s", (micros, text) => {
    expect(dollars(micros)).toBe(text);
  });

  it("property: compact up to billions, at most three digits, one decimal and a unit", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_000_000_000 }), (value) => {
        expect(compact(value)).toMatch(/^\d{1,3}(\.\d)?[KMB]?$/);
      }),
    );
  });
});

describe("deltas", () => {
  it.each([
    [10, null, null],
    [0, 0, { text: "0%", direction: "flat" }],
    [5, 0, { text: "new", direction: "up" }],
    [-5, 0, { text: "new", direction: "up" }],
    [150, 100, { text: "+50%", direction: "up" }],
    [50, 100, { text: `${MINUS}50%`, direction: "down" }],
    [1_001, 1_000, { text: "0%", direction: "flat" }],
    [1_006, 1_000, { text: "+1%", direction: "up" }],
    [-50, -100, { text: "+50%", direction: "up" }],
  ])("delta(%d, %s)", (current, previous, expected) => {
    expect(delta(current, previous)).toStrictEqual(expected);
  });
});

describe("times, UTC", () => {
  it("labels days, clocks and both", () => {
    expect(dayLabel(T0)).toBe("Oct 27");
    expect(dayLabel(Date.UTC(2026, 0, 3))).toBe("Jan 3");
    expect(dayLabel(Date.UTC(2026, 11, 31))).toBe("Dec 31");
    expect(
      Array.from({ length: 12 }, (_, month) => dayLabel(Date.UTC(2026, month, 1))),
    ).toStrictEqual([
      "Jan 1",
      "Feb 1",
      "Mar 1",
      "Apr 1",
      "May 1",
      "Jun 1",
      "Jul 1",
      "Aug 1",
      "Sep 1",
      "Oct 1",
      "Nov 1",
      "Dec 1",
    ]);
    expect(clockLabel(T0 + 5 * MINUTE)).toBe("12:05");
    expect(dateTimeLabel(T0)).toBe("Oct 27, 12:00 UTC");
  });

  it.each([
    [0, "just now"],
    [44 * SECOND, "just now"],
    [-44 * SECOND, "just now"],
    [45 * SECOND, "1 min ago"],
    [5 * MINUTE, "5 min ago"],
    [59 * MINUTE, "59 min ago"],
    [HOUR, "1 h ago"],
    [3 * HOUR + 20 * MINUTE, "3 h ago"],
    [DAY, "1 d ago"],
    [-4 * HOUR, "in 4 h"],
    [29 * DAY, "29 d ago"],
    [30 * DAY, "Sep 27"],
    [-30 * DAY, "Nov 26"],
  ])("relativeTime %d ms before now", (before, text) => {
    expect(relativeTime(T0 - before, T0)).toBe(text);
  });
});

describe("fileSize (GROKCHAT-18)", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [90 * 1024 + 300, "90 KB"],
    [1024 * 1024 - 1, "1024 KB"],
    [1024 * 1024, "1 MB"],
    [1.5 * 1024 * 1024, "1.5 MB"],
    [15 * 1024 * 1024, "15 MB"],
  ])("%i bytes is %s", (bytes, text) => {
    expect(fileSize(bytes)).toBe(text);
  });

  it("is never more than one decimal, and grows with the size (property)", () => {
    const value = (text: string): number => {
      const [number = "0", unit = "B"] = text.split(" ");
      return Number(number) * (unit === "MB" ? 1024 * 1024 : unit === "KB" ? 1024 : 1);
    };
    fc.assert(
      fc.property(fc.nat(64 * 1024 * 1024), fc.nat(64 * 1024 * 1024), (a, b) => {
        expect(fileSize(a)).toMatch(/^\d+(\.\d)? (B|KB|MB)$/);
        if (a < b) {
          expect(value(fileSize(a))).toBeLessThanOrEqual(value(fileSize(b)));
        }
      }),
    );
  });
});
