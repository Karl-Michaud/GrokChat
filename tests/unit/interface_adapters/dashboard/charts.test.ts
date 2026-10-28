import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  barRows,
  HEIGHT,
  INTERVALS,
  lineChart,
  meter,
  niceDomain,
  niceStep,
  SPARK_HEIGHT,
  SPARK_WIDTH,
  sparkline,
  tickLabels,
  WIDTH,
} from "../../../../src/interface_adapters/dashboard/charts";
import { exact } from "../../../../src/interface_adapters/dashboard/format";

const buckets = (...values: (number | null)[]) =>
  values.map((value, index) => ({ label: `d${String(index)}`, value }));

describe("chart scales (GROKCHAT-15, dataviz)", () => {
  it.each([
    [0, 1],
    [1, 1],
    [1.2, 2],
    [2, 2],
    [2.1, 2.5],
    [3, 5],
    [7, 10],
    [11, 20],
    [240, 250],
    [251, 500],
    [9_000, 10_000],
  ])("niceStep(%d) = %d", (raw, step) => {
    expect(niceStep(raw)).toBe(step);
  });

  it("a domain covers the values in four nice steps", () => {
    expect(niceDomain(0, 8_000)).toStrictEqual({ bottom: 0, step: 2_000 });
    expect(niceDomain(0, 0)).toStrictEqual({ bottom: 0, step: 1 });
    expect(niceDomain(7_780, 7_890)).toStrictEqual({ bottom: 7_750, step: 50 });
    expect(niceDomain(95, 101)).toStrictEqual({ bottom: 94, step: 2 });
    // The first step leaves the top short (8 + 4 × 2 < 17): the next nice step is taken.
    expect(niceDomain(9, 17)).toStrictEqual({ bottom: 7.5, step: 2.5 });
  });

  it("property: the domain starts at or below low and reaches high", () => {
    fc.assert(
      fc.property(fc.nat({ max: 1e7 }), fc.nat({ max: 1e7 }), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const { bottom, step } = niceDomain(low, high);
        expect(bottom).toBeLessThanOrEqual(low);
        expect(bottom + INTERVALS * step).toBeGreaterThanOrEqual(high);
        expect(step).toBe(niceStep(step));
      }),
    );
  });

  it("tick labels are compact unless two would read the same", () => {
    expect(tickLabels([8_000, 6_000, 0])).toStrictEqual(["8K", "6K", "0"]);
    expect(tickLabels([7_900, 7_850, 7_800])).toStrictEqual(["7,900", "7,850", "7,800"]);
  });
});

describe("line charts", () => {
  it("puts each point at its column's centre, with a wash closed to the baseline", () => {
    const chart = lineChart(buckets(0, 4, 2, 4), exact);
    expect(chart.line).toBe("M125 200 L375 0 L625 100 L875 0");
    expect(chart.area).toBe("M125 200 L375 0 L625 100 L875 0 L875 200 L125 200 Z");
    expect(chart.ticks).toStrictEqual(["4", "3", "2", "1", "0"]);
    expect(chart.gridlines).toStrictEqual([0, 50, 100, 150, 200]);
    expect(chart.empty).toBe(false);
    expect(chart.columns[1]).toStrictEqual({ label: "d1", value: "4", axisLabel: "d1" });
  });

  it("breaks the line at unknown values and shows them as a dash", () => {
    const chart = lineChart(buckets(null, 10, 20, null, 30), exact, false);
    expect(chart.line).toBe("M300 200 L500 100 M900 0");
    expect(chart.area).toBe("M300 200 L500 100 L500 200 L300 200 Z M900 0 L900 200 L900 200 Z");
    expect(chart.columns.map((column) => column.value)).toStrictEqual(["—", "10", "20", "—", "30"]);
    expect(chart.ticks).toStrictEqual(["30", "25", "20", "15", "10"]);
  });

  it("counts start at zero unless asked to fit the values", () => {
    expect(lineChart(buckets(50, 60), exact).ticks.at(-1)).toBe("0");
    expect(lineChart(buckets(50, 60), exact, false).ticks.at(-1)).toBe("50");
  });

  it("is empty when every value is zero or unknown", () => {
    expect(lineChart(buckets(0, null, 0), exact).empty).toBe(true);
    expect(lineChart(buckets(), exact)).toMatchObject({
      line: "",
      area: "",
      empty: true,
      columns: [],
    });
    expect(lineChart(buckets(null), exact).line).toBe("");
  });

  it("labels about six columns, always the last", () => {
    const chart = lineChart(buckets(...Array.from({ length: 24 }, () => 1)), exact);
    const labelled = chart.columns.flatMap((column, index) =>
      column.axisLabel === "" ? [] : [index],
    );
    expect(labelled).toStrictEqual([3, 7, 11, 15, 19, 23]);
    const few = lineChart(buckets(1, 2, 3), exact);
    expect(few.columns.map((column) => column.axisLabel)).toStrictEqual(["d0", "d1", "d2"]);
  });

  it("property: every point stays inside the plot box", () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: 0, max: 1e9 }), { nil: null }), { maxLength: 80 }),
        fc.boolean(),
        (values, zeroBased) => {
          const chart = lineChart(buckets(...values), exact, zeroBased);
          for (const [, x, y] of chart.line.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
            expect(Number(x)).toBeGreaterThanOrEqual(0);
            expect(Number(x)).toBeLessThanOrEqual(WIDTH);
            expect(Number(y)).toBeGreaterThanOrEqual(0);
            expect(Number(y)).toBeLessThanOrEqual(HEIGHT);
          }
          expect(chart.columns).toHaveLength(values.length);
        },
      ),
    );
  });
});

describe("sparklines (KPI tiles)", () => {
  it("runs edge to edge, fitted to the values, broken at unknown ones", () => {
    expect(sparkline([10, 20, 15])).toBe("M0 24 L50 0 L100 12");
    expect(sparkline([5, null, 5, 5])).toBe("M0 12 M66.7 12 L100 12");
    expect(sparkline([1, null, 3])).toBe("M0 24 M100 0");
  });

  it("is null with fewer than two known values", () => {
    expect(sparkline([])).toBeNull();
    expect(sparkline([7])).toBeNull();
    expect(sparkline([null, 7, null])).toBeNull();
  });

  it("property: every point stays inside the spark box, one per known value", () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: -1e6, max: 1e9 }), { nil: null }), { maxLength: 60 }),
        (values) => {
          const path = sparkline(values);
          const known = values.filter((value) => value !== null).length;
          if (known < 2) {
            expect(path).toBeNull();
            return;
          }
          const points = [...(path ?? "").matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)];
          expect(points).toHaveLength(known);
          for (const [, x, y] of points) {
            expect(Number(x)).toBeGreaterThanOrEqual(0);
            expect(Number(x)).toBeLessThanOrEqual(SPARK_WIDTH);
            expect(Number(y)).toBeGreaterThanOrEqual(0);
            expect(Number(y)).toBeLessThanOrEqual(SPARK_HEIGHT);
          }
        },
      ),
    );
  });
});

describe("bars and meters", () => {
  it("bars are shares of the longest, longest first, ties by label", () => {
    const rows = barRows(
      [
        { label: "c", value: 50 },
        { label: "a", value: 100 },
        { label: "b", value: 50 },
        { label: "d", value: -3 },
      ],
      exact,
    );
    expect(rows).toStrictEqual([
      { label: "a", value: "100", percent: 100 },
      { label: "b", value: "50", percent: 50 },
      { label: "c", value: "50", percent: 50 },
      { label: "d", value: "−3", percent: 0 },
    ]);
    expect(barRows([{ label: "z", value: 0 }], exact)).toStrictEqual([
      { label: "z", value: "0", percent: 0 },
    ]);
    expect(barRows([], exact)).toStrictEqual([]);
  });

  it("meters: share of the allowance, warning from three quarters of the guard, danger at it", () => {
    expect(meter(1, 8, 10)).toStrictEqual({ percent: 10, tone: "ok" });
    expect(meter(5.99, 8, 10)).toMatchObject({ tone: "ok" });
    expect(meter(6, 8, 10)).toStrictEqual({ percent: 60, tone: "warn" });
    expect(meter(8, 8, 10)).toStrictEqual({ percent: 80, tone: "danger" });
    expect(meter(20, 8, 10)).toStrictEqual({ percent: 100, tone: "danger" });
    expect(meter(-1, 8, 10)).toStrictEqual({ percent: 0, tone: "ok" });
  });
});
