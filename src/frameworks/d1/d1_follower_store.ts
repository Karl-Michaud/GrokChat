import { accountId, type AccountId } from "../../entities/identity/ids";
import type { FollowerSnapshot } from "../../entities/metrics/follower_snapshot";
import type { Instant, TimeWindow } from "../../entities/time/instant";
import type { FollowerDays, FollowerSchedule } from "../../use_cases/ports/follower_days";
import type { FollowerHistory } from "../../use_cases/ports/follower_history";

interface SnapshotRow {
  readonly account_id: string;
  readonly day: string;
  readonly taken_at: number;
  readonly followers: number;
  readonly following: number;
  readonly posts: number;
  readonly listed: number;
}

const fromRow = (row: SnapshotRow): FollowerSnapshot => ({
  accountId: accountId(row.account_id),
  day: row.day,
  takenAt: row.taken_at,
  followers: row.followers,
  following: row.following,
  posts: row.posts,
  listed: row.listed,
});

const RECORDED =
  "SELECT account_id, day, taken_at, followers, following, posts, listed FROM follower_snapshots";

/** Recorded rows in the window, then each account's newest recorded row before it. */
function historySql(oneAccount: boolean): string {
  const scope = oneAccount ? " AND account_id = ?3" : "";
  return (
    `${RECORDED} WHERE taken_at >= ?1 AND taken_at < ?2${scope} UNION ALL ` +
    `${RECORDED} AS f WHERE taken_at < ?1${scope} AND taken_at = (SELECT MAX(b.taken_at) ` +
    "FROM follower_snapshots AS b WHERE b.account_id = f.account_id AND b.taken_at < ?1) " +
    "ORDER BY taken_at, account_id"
  );
}

/**
 * `follower_snapshots` (migration 0003): one row per account and UTC day, its primary key the
 * once-a-day rule. A claim inserts the row with no counts; the read fills them in.
 */
export class D1FollowerStore implements FollowerDays, FollowerSchedule, FollowerHistory {
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

  async history(
    account: AccountId | null,
    window: TimeWindow,
  ): Promise<readonly FollowerSnapshot[]> {
    const statement = this.db.prepare(historySql(account !== null));
    const bound =
      account === null
        ? statement.bind(window.from, window.to)
        : statement.bind(window.from, window.to, account);
    return (await bound.all<SnapshotRow>()).results.map(fromRow);
  }
}
