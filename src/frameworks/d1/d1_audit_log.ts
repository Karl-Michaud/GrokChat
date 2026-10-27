import { accountId, postId } from "../../entities/identity/ids";
import type { AuditEvent } from "../../entities/records/audit_event";
import type { AuditFilter, AuditLog } from "../../use_cases/ports/audit_log";

interface AuditRow {
  readonly at: number;
  readonly actor: string;
  readonly action: string;
  readonly account_id: string | null;
  readonly post_id: string | null;
  readonly detail: string;
}

/** The insert, also run inside `commitPart`'s batch. */
export function auditInsert(db: D1Database, event: AuditEvent): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO audit_events (at, actor, action, account_id, post_id, detail) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(event.at, event.actor, event.action, event.accountId, event.postId, event.detail);
}

function fromRow(row: AuditRow): AuditEvent {
  return {
    at: row.at,
    actor: row.actor,
    action: row.action,
    accountId: row.account_id === null ? null : accountId(row.account_id),
    postId: row.post_id === null ? null : postId(row.post_id),
    detail: row.detail,
  };
}

/** Newest first is insertion order, newest first (`seq`), as the stub keeps it. */
export class D1AuditLog implements AuditLog {
  constructor(private readonly db: D1Database) {}

  async append(event: AuditEvent): Promise<void> {
    await auditInsert(this.db, event).run();
  }

  async list(filter: AuditFilter): Promise<readonly AuditEvent[]> {
    const { accountId: account, postId: post, window } = filter;
    const result = await this.db
      .prepare(
        "SELECT at, actor, action, account_id, post_id, detail FROM audit_events " +
          "WHERE (?1 IS NULL OR account_id = ?1) AND (?2 IS NULL OR post_id = ?2) " +
          "AND (?3 IS NULL OR (at >= ?3 AND at < ?4)) ORDER BY seq DESC LIMIT ?5",
      )
      .bind(
        account ?? null,
        post ?? null,
        window?.from ?? null,
        window?.to ?? null,
        filter.limit ?? -1,
      )
      .all<AuditRow>();
    return result.results.map(fromRow);
  }
}
