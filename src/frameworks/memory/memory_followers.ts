import type { AccountId } from "../../entities/identity/ids";
import type { FollowerSnapshot } from "../../entities/metrics/follower_snapshot";
import type { Instant } from "../../entities/time/instant";
import type { AccountRepository } from "../../use_cases/ports/account_repository";
import type { FollowerDays, FollowerSchedule } from "../../use_cases/ports/follower_days";

interface DayRow {
  readonly claimedAt: Instant;
  readonly snapshot: FollowerSnapshot | null;
}

/** `follower_snapshots` in memory: one row per account and day, keyed `account|day`. */
export class MemoryFollowerStore implements FollowerDays, FollowerSchedule {
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
}
