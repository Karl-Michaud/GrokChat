import type { CostTotals } from "../../entities/records/cost_entry";
import type { Refusal } from "../access/refusal";

export type CostTotalsOutputData =
  { readonly ok: true; readonly totals: CostTotals } | Refusal<"human_only">;
