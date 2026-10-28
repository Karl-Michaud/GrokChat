import { ACTIVITY_ACTIONS, type ActivityKind } from "../../entities/analytics/activity_kind";
import type { CostEstimate } from "../../entities/costs/estimate_cost";
import { accountId, postId } from "../../entities/identity/ids";
import type {
  ActivityEntry,
  ActivityFilter,
  ActivityLog,
  ActivityPage,
} from "../../use_cases/ports/activity_log";

interface ActivityRow {
  readonly at: number;
  readonly actor: string;
  readonly action: string;
  readonly account_id: string | null;
  readonly post_id: string | null;
  readonly detail: string;
  readonly costed: number;
  readonly micros: number | null;
}

/**
 * An X call's audit event and its cost entry are written together by `XCallRecorder`, at the same
 * instant, for the same account, the cost's operation being the action after `x.`; that is the
 * join. Two calls of one kind for one account in the same millisecond would share the first cost.
 */
const COST =
  "FROM cost_entries AS c WHERE c.at = a.at AND c.account_id = a.account_id " +
  "AND 'x.' || c.operation = a.action";

const COLUMNS =
  "a.at, a.actor, a.action, a.account_id, a.post_id, a.detail, " +
  `EXISTS (SELECT 1 ${COST}) AS costed, (SELECT c.micros ${COST} ORDER BY c.seq LIMIT 1) AS micros`;

type Clause = readonly [string, readonly unknown[]];

/** A prefix test that needs no LIKE escaping: `substr(column, 1, length(p)) = p`. */
const prefix = (column: string, value: string): Clause => [
  `substr(${column}, 1, length(?)) = ?`,
  [value, value],
];

function kindClause(kind: ActivityKind): Clause {
  const clauses = ACTIVITY_ACTIONS[kind].map((pattern): Clause =>
    pattern.endsWith(".") ? prefix("a.action", pattern) : ["a.action = ?", [pattern]],
  );
  return [`(${clauses.map(([sql]) => sql).join(" OR ")})`, clauses.flatMap(([, bound]) => bound)];
}

/** The filter's own fields as clauses, so each query only tests what it filters on. */
function clauses(filter: ActivityFilter): readonly Clause[] {
  const { accountId: account, postId: post, window, actor, kind } = filter;
  return [
    ...(account === undefined ? [] : [["a.account_id = ?", [account]] as const]),
    ...(post === undefined ? [] : [["a.post_id = ?", [post]] as const]),
    ...(window === undefined
      ? []
      : [["a.at >= ? AND a.at < ?", [window.from, window.to]] as const]),
    ...(actor === undefined ? [] : [prefix("a.actor", `${actor}:`)]),
    ...(kind === undefined ? [] : [kindClause(kind)]),
  ];
}

function where(filter: ActivityFilter): { readonly sql: string; readonly values: unknown[] } {
  const found = clauses(filter);
  return {
    sql: found.length === 0 ? "" : `WHERE ${found.map(([sql]) => sql).join(" AND ")}`,
    values: found.flatMap(([, bound]) => bound),
  };
}

function costOf(row: ActivityRow): CostEstimate | null {
  if (row.costed === 0) {
    return null;
  }
  return row.micros === null ? { kind: "unknown" } : { kind: "usd", micros: row.micros };
}

function fromRow(row: ActivityRow): ActivityEntry {
  return {
    at: row.at,
    actor: row.actor,
    action: row.action,
    accountId: row.account_id === null ? null : accountId(row.account_id),
    postId: row.post_id === null ? null : postId(row.post_id),
    detail: row.detail,
    cost: costOf(row),
  };
}

/** The activity page over `audit_events` and `cost_entries` (GROKCHAT-15), newest first (by time, then insertion). */
export class D1ActivityLog implements ActivityLog {
  constructor(private readonly db: D1Database) {}

  async page(filter: ActivityFilter, offset: number, limit: number): Promise<ActivityPage> {
    const { sql, values } = where(filter);
    const [rows, count] = await this.db.batch([
      this.db
        .prepare(
          `SELECT ${COLUMNS} FROM audit_events AS a ${sql} ORDER BY a.at DESC, a.seq DESC LIMIT ? OFFSET ?`,
        )
        .bind(...values, limit, offset),
      this.db.prepare(`SELECT COUNT(*) AS n FROM audit_events AS a ${sql}`).bind(...values),
    ]);
    const entries = (rows?.results ?? []) as ActivityRow[];
    const total = ((count?.results ?? []) as { n: number }[])[0]?.n ?? 0;
    return { entries: entries.map(fromRow), total };
  }
}
