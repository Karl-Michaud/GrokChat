import type { AccountId } from "../../entities/identity/ids";
import type { CostEntry, CostTotals } from "../../entities/records/cost_entry";
import type { TimeWindow } from "../../entities/time/instant";

export interface CostLedger {
  append(entry: CostEntry): Promise<void>;
  totals(window: TimeWindow, account: AccountId | null): Promise<CostTotals>;
}
