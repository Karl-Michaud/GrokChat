import type { AccountId, XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { AuditEvent } from "../../entities/records/audit_event";
import { totalCosts, type CostEntry, type CostTotals } from "../../entities/records/cost_entry";
import { inWindow, type TimeWindow } from "../../entities/time/instant";
import type { AuditFilter, AuditLog } from "../../use_cases/ports/audit_log";
import type { CostLedger } from "../../use_cases/ports/cost_ledger";
import type { MetricsHistory } from "../../use_cases/ports/metrics_history";
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

export class MemoryMetricsRepository implements MetricsRepository, MetricsHistory {
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

  history(account: AccountId | null, window: TimeWindow): Promise<readonly MetricsSnapshot[]> {
    const scoped = this.ordered().filter(
      (snapshot) => account === null || snapshot.accountId === account,
    );
    const inside = scoped.filter((snapshot) => inWindow(window, snapshot.takenAt));
    const posts = new Set(inside.map((snapshot) => snapshot.xPostId));
    const before = new Map<XPostId, MetricsSnapshot>();
    for (const snapshot of scoped) {
      if (posts.has(snapshot.xPostId) && snapshot.takenAt < window.from) {
        before.set(snapshot.xPostId, snapshot);
      }
    }
    return Promise.resolve(byTime([...inside, ...before.values()]));
  }

  postSeries(xPostIds: readonly XPostId[]): Promise<readonly MetricsSnapshot[]> {
    return Promise.resolve(
      this.ordered().filter((snapshot) => xPostIds.includes(snapshot.xPostId)),
    );
  }

  /** Oldest first; insertion order breaks a tie, as `seq` does in D1. */
  private ordered(): readonly MetricsSnapshot[] {
    return byTime(this.snapshots);
  }
}

function byTime(snapshots: readonly MetricsSnapshot[]): MetricsSnapshot[] {
  return snapshots
    .map((snapshot, index) => ({ snapshot, index }))
    .sort((a, b) => a.snapshot.takenAt - b.snapshot.takenAt || a.index - b.index)
    .map(({ snapshot }) => snapshot);
}
