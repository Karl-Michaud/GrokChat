import {
  accountId,
  type AccountId,
  type BotId,
  type IdempotencyKey,
  type PostId,
} from "../../entities/identity/ids";
import { activityOf, type RecentActivity } from "../../entities/policy/recent_activity";
import type { Post } from "../../entities/posts/post";
import { DAY, type Instant } from "../../entities/time/instant";
import type { AccountWork, PostFilter, PostReader } from "../../use_cases/ports/post_reader";
import type { PublishingCount } from "../../use_cases/ports/publishing_count";
import { postFilterSql } from "./post_filter_sql";
import { POST_COLUMNS, postFromRow, type PostRow } from "./post_rows";

/**
 * How far back `recentActivity` looks. The cap counts the account's local day, which began less
 * than 25 hours ago in any time zone (DST included), and a post's first attempt is taken over all
 * of its parts; the gap needs only the latest attempt, which is always included as well. So the
 * gate decides exactly as over every post, while the rows read stay bounded (plan §3.5).
 */
export const RECENT_WINDOW = 2 * DAY;

const RECENT_SQL =
  `SELECT ${POST_COLUMNS} FROM posts WHERE id IN (` +
  "SELECT post_id FROM post_parts WHERE account_id = ?1 AND attempt_at >= ?2 " +
  "UNION SELECT post_id FROM (SELECT post_id FROM post_parts WHERE account_id = ?1 " +
  "AND attempt_at IS NOT NULL ORDER BY attempt_at DESC LIMIT 1)) ORDER BY id";

/**
 * One query, every arm on an index (plan §3.2, A3): due waiting posts, posts left PUBLISHING,
 * UNKNOWN parts, and SENT parts whose next metrics read has passed.
 */
const WORK_SQL =
  "SELECT account_id, MIN(at) AS oldest, MAX(publish) AS publish, MAX(reconcile) AS reconcile, " +
  "MAX(metrics) AS metrics FROM (" +
  "SELECT account_id, due_at AS at, 1 AS publish, 0 AS reconcile, 0 AS metrics FROM posts " +
  "WHERE lifecycle IN ('SCHEDULED', 'RESUMING') AND due_at <= ?1 " +
  "UNION ALL SELECT account_id, ?1, 1, 0, 0 FROM posts WHERE lifecycle = 'PUBLISHING' " +
  "UNION ALL SELECT account_id, ?1, 0, 1, 0 FROM post_parts WHERE state_kind = 'UNKNOWN' " +
  "UNION ALL SELECT account_id, ?1, 0, 0, 1 FROM post_parts WHERE metrics_next_at <= ?1" +
  ") GROUP BY account_id ORDER BY oldest, account_id";

interface WorkRow {
  readonly account_id: string;
  readonly oldest: number;
  readonly publish: number;
  readonly reconcile: number;
  readonly metrics: number;
}

export class D1PostReader implements PostReader, PublishingCount {
  constructor(private readonly db: D1Database) {}

  async get(id: PostId): Promise<Post | null> {
    const row = await this.db
      .prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ?1`)
      .bind(id)
      .first<PostRow>();
    return row === null ? null : postFromRow(row);
  }

  async findByIdempotency(bot: BotId, key: IdempotencyKey): Promise<Post | null> {
    const row = await this.db
      .prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE bot_id = ?1 AND idempotency_key = ?2`)
      .bind(bot, key)
      .first<PostRow>();
    return row === null ? null : postFromRow(row);
  }

  /** On the `(lifecycle, publish_at)` index: one row read per PUBLISHING post. */
  async publishingCount(): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM posts WHERE lifecycle = 'PUBLISHING'")
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async list(filter: PostFilter): Promise<readonly Post[]> {
    const where = postFilterSql(filter);
    const result = await this.db
      .prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE ${where.sql} ORDER BY publish_at, id`)
      .bind(...where.params)
      .all<PostRow>();
    return result.results.map(postFromRow);
  }

  async recentActivity(account: AccountId, now: Instant): Promise<RecentActivity> {
    const result = await this.db
      .prepare(RECENT_SQL)
      .bind(account, now - RECENT_WINDOW)
      .all<PostRow>();
    return activityOf(result.results.map(postFromRow));
  }

  async accountsNeedingWork(now: Instant): Promise<readonly AccountWork[]> {
    const result = await this.db.prepare(WORK_SQL).bind(now).all<WorkRow>();
    return result.results.map((row) => ({
      accountId: accountId(row.account_id),
      oldestDueAt: row.oldest,
      publish: row.publish === 1,
      reconcile: row.reconcile === 1,
      metrics: row.metrics === 1,
    }));
  }
}
