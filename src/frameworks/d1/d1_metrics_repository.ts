import { accountId, xPostId, type AccountId, type XPostId } from "../../entities/identity/ids";
import type { MetricsSnapshot } from "../../entities/metrics/metrics_snapshot";
import type { TimeWindow } from "../../entities/time/instant";
import type { MetricsRepository } from "../../use_cases/ports/metrics_repository";
import { nextMetricsAtSql } from "./metrics_next";

interface SnapshotRow {
  readonly x_post_id: string;
  readonly account_id: string;
  readonly taken_at: number;
  readonly impressions: number;
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
  readonly bookmarks: number;
  readonly url_link_clicks: number | null;
  readonly user_profile_clicks: number | null;
}

const COLUMNS =
  "x_post_id, account_id, taken_at, impressions, likes, reposts, replies, quotes, bookmarks, " +
  "url_link_clicks, user_profile_clicks";

function fromRow(row: SnapshotRow): MetricsSnapshot {
  return {
    xPostId: xPostId(row.x_post_id),
    accountId: accountId(row.account_id),
    takenAt: row.taken_at,
    impressions: row.impressions,
    likes: row.likes,
    reposts: row.reposts,
    replies: row.replies,
    quotes: row.quotes,
    bookmarks: row.bookmarks,
    urlLinkClicks: row.url_link_clicks,
    userProfileClicks: row.user_profile_clicks,
  };
}

/** After a read, the part's next metrics read moves on (the index `accountsNeedingWork` uses). */
const ADVANCE_SQL =
  "UPDATE post_parts SET metrics_next_at = " +
  nextMetricsAtSql("sent_at", "(SELECT MAX(taken_at) FROM metrics WHERE x_post_id = ?1)") +
  " WHERE x_post_id = ?1";

/** The newest snapshot of each listed post (the later insert wins a tie), in first-read order. */
const LATEST_SQL =
  `SELECT ${COLUMNS} FROM metrics AS m WHERE x_post_id IN (SELECT value FROM json_each(?1)) ` +
  "AND seq = (SELECT seq FROM metrics WHERE x_post_id = m.x_post_id " +
  "ORDER BY taken_at DESC, seq DESC LIMIT 1) " +
  "ORDER BY (SELECT MIN(seq) FROM metrics WHERE x_post_id = m.x_post_id)";

export class D1MetricsRepository implements MetricsRepository {
  constructor(private readonly db: D1Database) {}

  async addSnapshots(snapshots: readonly MetricsSnapshot[]): Promise<void> {
    if (snapshots.length === 0) {
      return;
    }
    const inserts = snapshots.map((snapshot) => this.insert(snapshot));
    const posts = [...new Set(snapshots.map((snapshot) => snapshot.xPostId))];
    const advances = posts.map((id) => this.db.prepare(ADVANCE_SQL).bind(id));
    await this.db.batch([...inserts, ...advances]);
  }

  async series(account: AccountId, window: TimeWindow): Promise<readonly MetricsSnapshot[]> {
    const result = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM metrics WHERE account_id = ?1 AND taken_at >= ?2 ` +
          "AND taken_at < ?3 ORDER BY taken_at, seq",
      )
      .bind(account, window.from, window.to)
      .all<SnapshotRow>();
    return result.results.map(fromRow);
  }

  async latest(xPostIds: readonly XPostId[]): Promise<readonly MetricsSnapshot[]> {
    const result = await this.db
      .prepare(LATEST_SQL)
      .bind(JSON.stringify(xPostIds))
      .all<SnapshotRow>();
    return result.results.map(fromRow);
  }

  private insert(snapshot: MetricsSnapshot): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO metrics (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(
        snapshot.xPostId,
        snapshot.accountId,
        snapshot.takenAt,
        snapshot.impressions,
        snapshot.likes,
        snapshot.reposts,
        snapshot.replies,
        snapshot.quotes,
        snapshot.bookmarks,
        snapshot.urlLinkClicks,
        snapshot.userProfileClicks,
      );
  }
}
