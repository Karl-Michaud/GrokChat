import type { CostEstimate, XOperationKind } from "../costs/estimate_cost";
import type { AccountId } from "../identity/ids";
import type { Instant } from "../time/instant";

/** One X call's estimated cost (plan §2: every X call writes one). */
export interface CostEntry {
  readonly at: Instant;
  readonly accountId: AccountId;
  readonly operation: XOperationKind;
  readonly estimate: CostEstimate;
}

/** Totals over a window: unknown-priced calls are counted, never guessed. */
export interface CostTotals {
  readonly micros: number;
  readonly calls: number;
  readonly unknownPriced: number;
}

export function totalCosts(entries: readonly CostEntry[]): CostTotals {
  const priced = entries.flatMap((entry) =>
    entry.estimate.kind === "usd" ? [entry.estimate.micros] : [],
  );
  return {
    micros: priced.reduce((sum, micros) => sum + micros, 0),
    calls: entries.length,
    unknownPriced: entries.length - priced.length,
  };
}
