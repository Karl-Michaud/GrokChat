import { engagements, type MetricValues } from "../../entities/analytics/metric_values";
import { compact } from "./format";

/** A post's metrics as table cells (GROKCHAT-15). */
export interface MetricCells {
  readonly impressions: string;
  readonly engagements: string;
  readonly likes: string;
  readonly reposts: string;
  readonly replies: string;
  readonly linkClicks: string;
}

const NONE = "—";

export function metricCells(values: MetricValues | null): MetricCells {
  const cell = (value: number) => (values === null ? NONE : compact(value));
  return {
    impressions: cell(values?.impressions ?? 0),
    engagements: cell(values === null ? 0 : engagements(values)),
    likes: cell(values?.likes ?? 0),
    reposts: cell(values?.reposts ?? 0),
    replies: cell(values?.replies ?? 0),
    linkClicks: cell(values?.linkClicks ?? 0),
  };
}
