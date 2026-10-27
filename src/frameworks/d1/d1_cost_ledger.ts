import type { AccountId } from "../../entities/identity/ids";
import type { CostEntry, CostTotals } from "../../entities/records/cost_entry";
import type { TimeWindow } from "../../entities/time/instant";
import type { CostLedger } from "../../use_cases/ports/cost_ledger";

/** The insert, also run inside `commitPart`'s batch. An unpriced call stores NULL micros. */
export function costInsert(db: D1Database, entry: CostEntry): D1PreparedStatement {
  const micros = entry.estimate.kind === "usd" ? entry.estimate.micros : null;
  return db
    .prepare("INSERT INTO cost_entries (at, account_id, operation, micros) VALUES (?1, ?2, ?3, ?4)")
    .bind(entry.at, entry.accountId, entry.operation, micros);
}

interface TotalsRow {
  readonly micros: number;
  readonly calls: number;
  readonly unknown_priced: number;
}

export class D1CostLedger implements CostLedger {
  constructor(private readonly db: D1Database) {}

  async append(entry: CostEntry): Promise<void> {
    await costInsert(this.db, entry).run();
  }

  async totals(window: TimeWindow, account: AccountId | null): Promise<CostTotals> {
    const row = await this.db
      .prepare(
        "SELECT COALESCE(SUM(micros), 0) AS micros, COUNT(*) AS calls, " +
          "COUNT(*) - COUNT(micros) AS unknown_priced FROM cost_entries " +
          "WHERE at >= ?1 AND at < ?2 AND (?3 IS NULL OR account_id = ?3)",
      )
      .bind(window.from, window.to, account)
      .first<TotalsRow>();
    // An aggregate without GROUP BY always returns one row.
    const totals = row ?? { micros: 0, calls: 0, unknown_priced: 0 };
    return { micros: totals.micros, calls: totals.calls, unknownPriced: totals.unknown_priced };
  }
}
