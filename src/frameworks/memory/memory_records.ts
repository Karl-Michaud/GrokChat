import type { AccountId, XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { AuditEvent } from "../../entities/records/audit_event";
import { totalCosts, type CostEntry, type CostTotals } from "../../entities/records/cost_entry";
import { inWindow, type TimeWindow } from "../../entities/time/instant";
import type { AuditFilter, AuditLog } from "../../use_cases/ports/audit_log";
import type { CostLedger } from "../../use_cases/ports/cost_ledger";
import type { MetricsRepository } from "../../use_cases/ports/metrics_repository";

export class MemoryAuditLog implements AuditLog {
  readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  list(filter: AuditFilter): Promise<readonly AuditEvent[]> {
    const { accountId, postId, window } = filter;
    const found = this.events.filter(
      (event) =>
        (accountId === undefined || event.accountId === accountId) &&
        (postId === undefined || event.postId === postId) &&
        (window === undefined || inWindow(window, event.at)),
    );
    return Promise.resolve(found.reverse().slice(0, filter.limit ?? found.length));
  }
}

export class MemoryCostLedger implements CostLedger {
  readonly entries: CostEntry[] = [];

  append(entry: CostEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }

  totals(window: TimeWindow, account: AccountId | null): Promise<CostTotals> {
    const matching = this.entries.filter(
      (entry) => inWindow(window, entry.at) && (account === null || entry.accountId === account),
    );
    return Promise.resolve(totalCosts(matching));
  }
}

export class MemoryMetricsRepository implements MetricsRepository {
  readonly snapshots: MetricsSnapshot[] = [];

  addSnapshots(snapshots: readonly MetricsSnapshot[]): Promise<void> {
    this.snapshots.push(...snapshots);
    return Promise.resolve();
  }

  series(account: AccountId, window: TimeWindow): Promise<readonly MetricsSnapshot[]> {
    const found = this.snapshots.filter(
      (snapshot) => snapshot.accountId === account && inWindow(window, snapshot.takenAt),
    );
    return Promise.resolve(found.sort((a, b) => a.takenAt - b.takenAt));
  }

  latest(xPostIds: readonly XPostId[]): Promise<readonly MetricsSnapshot[]> {
    const newest = new Map<XPostId, MetricsSnapshot>();
    for (const snapshot of this.snapshots) {
      const current = newest.get(snapshot.xPostId);
      if (
        xPostIds.includes(snapshot.xPostId) &&
        (current === undefined || snapshot.takenAt >= current.takenAt)
      ) {
        newest.set(snapshot.xPostId, snapshot);
      }
    }
    return Promise.resolve([...newest.values()]);
  }
}
