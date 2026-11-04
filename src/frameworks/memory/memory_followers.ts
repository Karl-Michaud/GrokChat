import type { AccountId } from "../../entities/identity/ids";
import type { FollowerSnapshot } from "../../entities/metrics/follower_snapshot";
import { inWindow, type Instant, type TimeWindow } from "../../entities/time/instant";
import type { AccountRepository } from "../../use_cases/ports/account_repository";
import type { FollowerDays, FollowerSchedule } from "../../use_cases/ports/follower_days";
import type { FollowerHistory } from "../../use_cases/ports/follower_history";

interface DayRow {
  readonly claimedAt: Instant;
  readonly snapshot: FollowerSnapshot | null;
}

/** `follower_snapshots` in memory: one row per account and day, keyed `account|day`. */
export class MemoryFollowerStore implements FollowerDays, FollowerSchedule, FollowerHistory {
  readonly rows = new Map<string, DayRow>();

  constructor(private readonly accounts: AccountRepository) {}

  claim(account: AccountId, day: string, at: Instant): Promise<boolean> {
    const key = `${account}|${day}`;
    if (this.rows.has(key)) {
      return Promise.resolve(false);
    }
    this.rows.set(key, { claimedAt: at, snapshot: null });
    return Promise.resolve(true);
  }

  release(account: AccountId, day: string): Promise<void> {
    const key = `${account}|${day}`;
    if (this.rows.get(key)?.snapshot === null) {
      this.rows.delete(key);
    }
    return Promise.resolve();
  }

  record(snapshot: FollowerSnapshot): Promise<void> {
    const key = `${snapshot.accountId}|${snapshot.day}`;
    const row = this.rows.get(key);
    if (row !== undefined) {
      this.rows.set(key, { claimedAt: row.claimedAt, snapshot });
    }
    return Promise.resolve();
  }

  async accountsDue(day: string): Promise<readonly AccountId[]> {
    const connected = (await this.accounts.list()).filter(
      (account) => account.status === "ACTIVE" || account.status === "PAUSED",
    );
    return connected.map((account) => account.id).filter((id) => !this.rows.has(`${id}|${day}`));
  }

  history(account: AccountId | null, window: TimeWindow): Promise<readonly FollowerSnapshot[]> {
    const recorded = [...this.rows.values()]
      .flatMap((row) => (row.snapshot === null ? [] : [row.snapshot]))
      .filter((snapshot) => account === null || snapshot.accountId === account)
      .sort((a, b) => a.takenAt - b.takenAt || a.accountId.localeCompare(b.accountId));
    const before = new Map<AccountId, FollowerSnapshot>();
    for (const snapshot of recorded.filter((item) => item.takenAt < window.from)) {
      before.set(snapshot.accountId, snapshot);
    }
    const inside = recorded.filter((snapshot) => inWindow(window, snapshot.takenAt));
    return Promise.resolve(
      [...before.values(), ...inside].sort(
        (a, b) => a.takenAt - b.takenAt || a.accountId.localeCompare(b.accountId),
      ),
    );
  }
}
