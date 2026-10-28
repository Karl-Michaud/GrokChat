import { accountId, type AccountId } from "../../entities/identity/ids";
import type { FollowerSnapshot } from "../../entities/metrics/follower_snapshot";
import type { Instant } from "../../entities/time/instant";
import type { FollowerDays, FollowerSchedule } from "../../use_cases/ports/follower_days";

/**
 * `follower_snapshots` (migration 0003): one row per account and UTC day, its primary key the
 * once-a-day rule. A claim inserts the row with no counts; the read fills them in.
 */
export class D1FollowerStore implements FollowerDays, FollowerSchedule {
  constructor(private readonly db: D1Database) {}

  async claim(account: AccountId, day: string, at: Instant): Promise<boolean> {
    const result = await this.db
      .prepare(
        "INSERT INTO follower_snapshots (account_id, day, claimed_at) VALUES (?1, ?2, ?3) " +
          "ON CONFLICT (account_id, day) DO NOTHING",
      )
      .bind(account, day, at)
      .run();
    return result.meta.changes === 1;
  }

  async release(account: AccountId, day: string): Promise<void> {
    await this.db
      .prepare(
        "DELETE FROM follower_snapshots WHERE account_id = ?1 AND day = ?2 AND taken_at IS NULL",
      )
      .bind(account, day)
      .run();
  }

  async record(snapshot: FollowerSnapshot): Promise<void> {
    await this.db
      .prepare(
        "UPDATE follower_snapshots SET taken_at = ?3, followers = ?4, following = ?5, " +
          "posts = ?6, listed = ?7 WHERE account_id = ?1 AND day = ?2",
      )
      .bind(
        snapshot.accountId,
        snapshot.day,
        snapshot.takenAt,
        snapshot.followers,
        snapshot.following,
        snapshot.posts,
        snapshot.listed,
      )
      .run();
  }

  async accountsDue(day: string): Promise<readonly AccountId[]> {
    const result = await this.db
      .prepare(
        "SELECT id FROM accounts WHERE status IN ('ACTIVE', 'PAUSED') AND NOT EXISTS " +
          "(SELECT 1 FROM follower_snapshots AS f WHERE f.account_id = accounts.id AND f.day = ?1) " +
          "ORDER BY id",
      )
      .bind(day)
      .all<{ readonly id: string }>();
    return result.results.map((row) => accountId(row.id));
  }
}
