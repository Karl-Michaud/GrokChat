import { compact, exact } from "./format";

/**
 * Chart geometry for the server-rendered SVG charts (GROKCHAT-15, dataviz skill): pure numbers
 * the views draw. The plot is a `0..WIDTH × 0..HEIGHT` box stretched to its card; each bucket is
 * a column of equal width, its point at the column's centre, so the HTML hover columns and axis
 * labels laid out with flex line up with the marks exactly.
 */
export const WIDTH = 1000;
export const HEIGHT = 200;
/** Gridlines: the baseline and four intervals above it. */
export const INTERVALS = 4;
/** About this many x labels, the last bucket always labelled. */
export const X_LABELS = 6;

export interface ChartBucket {
  /** Shown under the axis and in the tooltip. */
  readonly label: string;
  /** Null: nothing known yet (followers before the first read). */
  readonly value: number | null;
}

export interface ChartColumn {
  readonly label: string;
  /** The value as the tooltip shows it; "—" when unknown. */
  readonly value: string;
  readonly axisLabel: string;
}

export interface LineChartView {
  /** The line, `M`…`L`…, broken where values are unknown. */
  readonly line: string;
  /** The wash under the line, one closed shape per unbroken run. */
  readonly area: string;
  /** Tick labels, top first. */
  readonly ticks: readonly string[];
  /** Gridline heights in the plot box, top first. */
  readonly gridlines: readonly number[];
  readonly columns: readonly ChartColumn[];
  /** True when no bucket has a value other than zero or unknown. */
  readonly empty: boolean;
}

/** The smallest of 1, 2, 2.5, 5 × 10ⁿ at or above `raw`, at least 1 (counts are whole). */
export function niceStep(raw: number): number {
  const value = Math.max(1, raw);
  const power = 10 ** Math.floor(Math.log10(value));
  const nice = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= value) ?? 10;
  return nice * power;
}

/** A tick range `[bottom, bottom + 4 steps]` covering `[low, high]`. */
export function niceDomain(
  low: number,
  high: number,
): { readonly bottom: number; readonly step: number } {
  let step = niceStep((high - low) / INTERVALS);
  let bottom = Math.floor(low / step) * step;
  while (bottom + INTERVALS * step < high) {
    step = niceStep(step * 1.01);
    bottom = Math.floor(low / step) * step;
  }
  return { bottom, step };
}

const round = (value: number): number => Math.round(value * 10) / 10;

type Point = readonly [number, number];
type Run = readonly [Point, ...Point[]];

/** The known values as points, split into the unbroken runs between unknown ones. */
function runs(values: readonly (number | null)[], y: (value: number) => number): readonly Run[] {
  const found: Point[][] = [];
  let current: Point[] | null = null;
  values.forEach((value, index) => {
    if (value === null) {
      current = null;
      return;
    }
    const point: Point = [round(((index + 0.5) * WIDTH) / values.length), round(y(value))];
    if (current === null) {
      current = [];
      found.push(current);
    }
    current.push(point);
  });
  return found as unknown as readonly Run[];
}

const pathOf = (run: Run): string =>
  run.map(([x, y], index) => `${index === 0 ? "M" : "L"}${String(x)} ${String(y)}`).join(" ");

function areaOf(run: Run): string {
  const [first] = run;
  const last = run.reduce((_, point) => point);
  return `${pathOf(run)} L${String(last[0])} ${String(HEIGHT)} L${String(first[0])} ${String(HEIGHT)} Z`;
}

/** Compact tick labels (1.2K), or exact ones when compact would print two ticks the same. */
export function tickLabels(ticks: readonly number[]): readonly string[] {
  const short = ticks.map(compact);
  return new Set(short).size === short.length ? short : ticks.map(exact);
}

/**
 * A line chart over the buckets. Counts start at zero; `zeroBased: false` (followers) fits the
 * axis to the values instead, so a change of a few hundred on thousands is visible.
 */
export function lineChart(
  buckets: readonly ChartBucket[],
  format: (value: number) => string,
  zeroBased = true,
): LineChartView {
  const known = buckets.flatMap((bucket) => (bucket.value === null ? [] : [bucket.value]));
  const high = Math.max(0, ...known);
  const low = zeroBased ? 0 : Math.min(high, ...known);
  const { bottom, step } = niceDomain(low, high);
  const span = INTERVALS * step;
  const y = (value: number): number => HEIGHT - ((value - bottom) / span) * HEIGHT;
  const unbroken = runs(
    buckets.map((bucket) => bucket.value),
    y,
  );
  const ticks = Array.from(
    { length: INTERVALS + 1 },
    (_, index) => bottom + (INTERVALS - index) * step,
  );
  const every = Math.max(1, Math.ceil(buckets.length / X_LABELS));
  return {
    line: unbroken.map(pathOf).join(" "),
    area: unbroken.map(areaOf).join(" "),
    ticks: tickLabels(ticks),
    gridlines: ticks.map((tick) => round(y(tick))),
    columns: buckets.map((bucket, index) => ({
      label: bucket.label,
      value: bucket.value === null ? "—" : format(bucket.value),
      axisLabel: (buckets.length - 1 - index) % every === 0 ? bucket.label : "",
    })),
    empty: known.every((value) => value === 0),
  };
}

/** The sparkline box: a KPI tile's trend, stretched to the tile's width. */
export const SPARK_WIDTH = 100;
export const SPARK_HEIGHT = 24;

/**
 * A sparkline's path over the values: the first at the left edge, the last at the right, fitted
 * between the lowest and highest known value (a flat series runs through the middle), broken
 * where a value is unknown. Null when fewer than two values are known: no trend to draw.
 */
export function sparkline(values: readonly (number | null)[]): string | null {
  const known = values.flatMap((value) => (value === null ? [] : [value]));
  if (known.length < 2) {
    return null;
  }
  const low = Math.min(...known);
  const span = Math.max(...known) - low;
  const y = (value: number): number =>
    span === 0 ? SPARK_HEIGHT / 2 : SPARK_HEIGHT - ((value - low) / span) * SPARK_HEIGHT;
  const last = values.length - 1;
  let open = false;
  const steps = values.flatMap((value, index) => {
    if (value === null) {
      open = false;
      return [];
    }
    const command = open ? "L" : "M";
    open = true;
    return [`${command}${String(round((index * SPARK_WIDTH) / last))} ${String(round(y(value)))}`];
  });
  return steps.join(" ");
}

export interface BarRow {
  readonly label: string;
  readonly value: string;
  /** The bar's length as a share of the longest, 0 to 100. */
  readonly percent: number;
}

/** Horizontal bars, longest first, each a share of the longest (none when all are zero). */
export function barRows(
  rows: readonly { readonly label: string; readonly value: number }[],
  format: (value: number) => string,
): readonly BarRow[] {
  const longest = Math.max(0, ...rows.map((row) => row.value));
  return [...rows]
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .map((row) => ({
      label: row.label,
      value: format(row.value),
      percent: longest <= 0 ? 0 : round((Math.max(0, row.value) / longest) * 100),
    }));
}

export type MeterTone = "ok" | "warn" | "danger";

export interface MeterView {
  /** Of the allowance, 0 to 100. */
  readonly percent: number;
  readonly tone: MeterTone;
}

/** Usage against a free allowance: danger at the guard, warning from three quarters of it. */
export function meter(used: number, guard: number, allowance: number): MeterView {
  const tone: MeterTone = used >= guard ? "danger" : used >= guard * 0.75 ? "warn" : "ok";
  return { percent: round(Math.min(100, (Math.max(0, used) / allowance) * 100)), tone };
}
