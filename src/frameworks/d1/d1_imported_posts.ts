import { accountId, xPostId, type AccountId } from "../../entities/identity/ids";
import { IMPORT_INTERVAL, type ImportedPost } from "../../entities/posts/imported_post";
import type { Instant } from "../../entities/time/instant";
import type {
  ImportCursor,
  ImportedPostFilter,
  ImportedPostStore,
  ImportSchedule,
} from "../../use_cases/ports/imported_posts";
import { nextMetricsAtSql } from "./metrics_next";

interface ImportedRow {
  readonly x_post_id: string;
  readonly account_id: string;
  readonly text: string;
  readonly created_at: number;
  readonly in_reply_to_x_post_id: string | null;
  readonly imported_at: number;
}

const COLUMNS = "x_post_id, account_id, text, created_at, in_reply_to_x_post_id, imported_at";

const fromRow = (row: ImportedRow): ImportedPost => ({
  xPostId: xPostId(row.x_post_id),
  accountId: accountId(row.account_id),
  text: row.text,
  createdAt: row.created_at,
  inReplyTo: row.in_reply_to_x_post_id === null ? null : xPostId(row.in_reply_to_x_post_id),
  importedAt: row.imported_at,
});

/** True when GrokChat published the post with X id `column` itself (on `post_parts_x_post`). */
const OURS = (column: string): string =>
  `EXISTS (SELECT 1 FROM post_parts WHERE x_post_id = ${column} ` +
  "AND state_kind IN ('SENT', 'DELETED'))";

/** A new post, with its first metrics read due, unless stored already or published by GrokChat. */
const INSERT_SQL =
  `INSERT INTO imported_posts (${COLUMNS}, metrics_next_at) ` +
  `SELECT ?1, ?2, ?3, ?4, ?5, ?6, ${nextMetricsAtSql("?4", "NULL")} WHERE NOT ${OURS("?1")} ` +
  "ON CONFLICT (x_post_id) DO NOTHING";

const FINISH_SQL =
  "INSERT INTO post_imports (account_id, last_run_at, newest_created_at) VALUES (?1, ?2, ?3) " +
  "ON CONFLICT (account_id) DO UPDATE SET last_run_at = excluded.last_run_at, " +
  "newest_created_at = COALESCE(excluded.newest_created_at, post_imports.newest_created_at)";

/**
 * Connected accounts whose last import is older than the interval (`?2` = now − interval), then
 * accounts with an imported post whose next metrics read has passed (`?1` = now).
 */
const DUE_SQL =
  "SELECT id FROM accounts WHERE status IN ('ACTIVE', 'PAUSED') AND NOT EXISTS " +
  "(SELECT 1 FROM post_imports AS p WHERE p.account_id = accounts.id AND p.last_run_at > ?2) " +
  "UNION SELECT account_id FROM imported_posts AS i WHERE metrics_next_at <= ?1 " +
  `AND NOT ${OURS("i.x_post_id")} ORDER BY 1`;

/** `imported_posts` and `post_imports` (GROKCHAT-19, migration 0007). */
export class D1ImportedPosts implements ImportedPostStore, ImportSchedule {
  constructor(private readonly db: D1Database) {}

  async cursor(account: AccountId): Promise<ImportCursor> {
    const row = await this.db
      .prepare("SELECT last_run_at, newest_created_at FROM post_imports WHERE account_id = ?1")
      .bind(account)
      .first<{ readonly last_run_at: number; readonly newest_created_at: number | null }>();
    return row === null
      ? { lastRunAt: null, newestCreatedAt: null }
      : { lastRunAt: row.last_run_at, newestCreatedAt: row.newest_created_at };
  }

  async add(posts: readonly ImportedPost[]): Promise<number> {
    if (posts.length === 0) {
      return 0;
    }
    const results = await this.db.batch(
      posts.map((post) =>
        this.db
          .prepare(INSERT_SQL)
          .bind(
            post.xPostId,
            post.accountId,
            post.text,
            post.createdAt,
            post.inReplyTo,
            post.importedAt,
          ),
      ),
    );
    return results.reduce((sum, result) => sum + result.meta.changes, 0);
  }

  async finish(account: AccountId, at: Instant, newest: Instant | null): Promise<void> {
    await this.db.prepare(FINISH_SQL).bind(account, at, newest).run();
  }

  async list(filter: ImportedPostFilter): Promise<readonly ImportedPost[]> {
    const conditions = [`NOT ${OURS("i.x_post_id")}`];
    const values: (string | number)[] = [];
    if (filter.accountIds !== undefined) {
      values.push(JSON.stringify(filter.accountIds));
      conditions.push(`account_id IN (SELECT value FROM json_each(?${String(values.length)}))`);
    }
    if (filter.createdWindow !== undefined) {
      values.push(filter.createdWindow.from, filter.createdWindow.to);
      const to = values.length;
      conditions.push(`created_at >= ?${String(to - 1)} AND created_at < ?${String(to)}`);
    }
    const result = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM imported_posts AS i WHERE ${conditions.join(" AND ")} ` +
          "ORDER BY created_at, x_post_id",
      )
      .bind(...values)
      .all<ImportedRow>();
    return result.results.map(fromRow);
  }

  async accountsDue(now: Instant): Promise<readonly AccountId[]> {
    const result = await this.db
      .prepare(DUE_SQL)
      .bind(now, now - IMPORT_INTERVAL)
      .all<{ readonly id: string }>();
    return result.results.map((row) => accountId(row.id));
  }
}
