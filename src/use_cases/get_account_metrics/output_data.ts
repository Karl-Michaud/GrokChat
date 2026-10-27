import type { AccountId } from "../../entities/identity/ids";
import type { MetricName, MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { Refusal } from "../access/refusal";

/** Totals over the newest snapshot of each post read in the window, and the series itself. */
export type GetAccountMetricsOutputData =
  | {
      readonly ok: true;
      readonly accountId: AccountId;
      readonly posts: number;
      readonly totals: Readonly<Record<MetricName, number>>;
      readonly series: readonly MetricsSnapshot[];
    }
  | Refusal<"scope">;
