import type { Account } from "../../entities/accounts/account";
import { accountId } from "../../entities/identity/ids";
import { METRIC_NAMES, type MetricName } from "../../entities/metrics/metrics_snapshot";
import type { CostTotals } from "../../entities/records/cost_entry";
import { DAY } from "../../entities/time/instant";
import type { CostTotalsOutputData } from "../../use_cases/cost_totals/output_data";
import type { Clock } from "../../use_cases/ports/clock";
import { accountOptions, handleOf, loadAccounts, type AccountOption } from "./account_directory";
import { ADMIN } from "./admin_actor";
import { filled, parseWhole } from "./form_values";
import { invalid, page, refused, type Outcome } from "./outcome";
import { runUseCase } from "./presenter";
import {
  auditRow,
  costRow,
  mediaRows,
  type AuditRow,
  type CostRow,
  type MediaRow,
} from "./report_views";
import type { ReportUseCases } from "./use_cases";

export interface MetricTotal {
  readonly name: MetricName;
  readonly value: number;
}

export interface MetricsView {
  readonly accounts: readonly AccountOption[];
  /** The account shown, as `@handle`; null when there is none yet. */
  readonly account: string | null;
  readonly days: number;
  readonly posts: number;
  readonly totals: readonly MetricTotal[];
  readonly snapshots: number;
}

export interface CostsView {
  readonly days: number;
  readonly total: CostRow;
  readonly accounts: readonly CostRow[];
}

export interface MediaView {
  readonly month: string;
  readonly rows: readonly MediaRow[];
}

export interface AuditView {
  readonly accounts: readonly AccountOption[];
  readonly limit: number;
  readonly events: readonly AuditRow[];
}

/** A whole number from 1 to `max`, the fallback when absent; null when out of range. */
function bounded(value: string | null, fallback: number, max: number): number | null {
  const text = filled(value);
  if (text === null) {
    return fallback;
  }
  const number = parseWhole(text) ?? 0;
  return number >= 1 && number <= max ? number : null;
}

/** The read-only reports: metrics, costs, R2 media usage, audit (plan §3.4, §3.5). */
export class ReportsController {
  constructor(
    private readonly useCases: ReportUseCases,
    private readonly clock: Clock,
  ) {}

  async metrics(query: {
    readonly account: string | null;
    readonly days: string | null;
  }): Promise<Outcome<MetricsView>> {
    const days = bounded(query.days, 7, 90);
    if (days === null) {
      return invalid("Days must be a whole number from 1 to 90.");
    }
    const accounts = await loadAccounts(this.useCases);
    const chosen = filled(query.account) ?? accounts[0]?.id ?? null;
    const view = { accounts: accountOptions(accounts, chosen), days, snapshots: 0 };
    if (chosen === null) {
      return page({ ...view, account: null, posts: 0, totals: [] });
    }
    const now = this.clock.now();
    const input = {
      actor: ADMIN,
      accountId: accountId(chosen),
      window: { from: now - days * DAY, to: now },
    };
    const result = await runUseCase(this.useCases.accountMetrics, input, (output) => output);
    if (!result.ok) {
      return refused(result.code);
    }
    return page({
      ...view,
      account: handleOf(accounts, chosen),
      posts: result.posts,
      totals: METRIC_NAMES.map((name) => ({ name, value: result.totals[name] })),
      snapshots: result.series.length,
    });
  }

  async costs(query: { readonly days: string | null }): Promise<Outcome<CostsView>> {
    const days = bounded(query.days, 30, 366);
    if (days === null) {
      return invalid("Days must be a whole number from 1 to 366.");
    }
    const now = this.clock.now();
    const window = { from: now - days * DAY, to: now };
    const totals = (account: Account | null): Promise<CostTotals | string> =>
      runUseCase(
        this.useCases.costTotals,
        { actor: ADMIN, window, accountId: account === null ? null : account.id },
        (output: CostTotalsOutputData) => (output.ok ? output.totals : output.code),
      );
    const total = await totals(null);
    if (typeof total === "string") {
      return refused(total);
    }
    const accounts = await loadAccounts(this.useCases);
    const rows: CostRow[] = [];
    for (const account of accounts) {
      const each = await totals(account);
      if (typeof each !== "string") {
        rows.push(costRow(`@${account.handle}`, each));
      }
    }
    return page({ days, total: costRow("All accounts", total), accounts: rows });
  }

  media(): Promise<Outcome<MediaView>> {
    return runUseCase(this.useCases.mediaUsage, { actor: ADMIN }, (output) =>
      output.ok
        ? page({
            month: output.usage.month,
            rows: mediaRows(output.usage, output.guards, output.allowance),
          })
        : refused(output.code),
    );
  }

  async audit(query: {
    readonly account: string | null;
    readonly limit: string | null;
  }): Promise<Outcome<AuditView>> {
    const limit = bounded(query.limit, 100, 500);
    if (limit === null) {
      return invalid("The limit must be a whole number from 1 to 500.");
    }
    const account = filled(query.account);
    const accounts = await loadAccounts(this.useCases);
    const filter = account === null ? { limit } : { accountId: accountId(account), limit };
    const result = await runUseCase(
      this.useCases.auditList,
      { actor: ADMIN, filter },
      (output) => output,
    );
    if (!result.ok) {
      return refused(result.code);
    }
    return page({
      accounts: accountOptions(accounts, account),
      limit,
      events: result.events.map((event) => auditRow(event, accounts)),
    });
  }
}
