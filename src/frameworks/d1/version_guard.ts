import type { PostId } from "../../entities/identity/ids";
import type { Lifecycle } from "../../entities/posts/post";
import type { SaveResult } from "../../use_cases/ports/post_writer";

/**
 * The raising first statement of a multi-statement post write (plan §3.5, U15): it inserts NULL
 * into `version_guard(ok INTEGER NOT NULL)` unless the post still has the expected version and
 * lifecycle, so a stale write fails the whole batch and D1 rolls every statement back. A guard
 * that matched 0 rows in a plain `UPDATE` would not: the batch would commit (M2-feas).
 */
const GUARD_SQL =
  "INSERT INTO version_guard (ok) SELECT CASE WHEN EXISTS (" +
  "SELECT 1 FROM posts WHERE id = ?1 AND version = ?2 AND lifecycle = ?3" +
  ") THEN 1 ELSE NULL END";

/** The batch's last statement: the guard table is empty between batches. */
const CLEAR_SQL = "DELETE FROM version_guard";

/** What D1 reports when the guard raised (and nothing else does: only this table has `ok`). */
const GUARD_FAILURE = "NOT NULL constraint failed: version_guard.ok";

export interface ExpectedPost {
  readonly id: PostId;
  readonly version: number;
  readonly lifecycle: Lifecycle;
}

export function isGuardFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes(GUARD_FAILURE);
}

/**
 * Runs `statements` between the guard and the clear in one D1 batch: all of them or none. A
 * raised guard is a version conflict; any other failure is rethrown.
 */
export async function guardedBatch(
  db: D1Database,
  expected: ExpectedPost,
  statements: readonly D1PreparedStatement[],
): Promise<SaveResult> {
  const guard = db.prepare(GUARD_SQL).bind(expected.id, expected.version, expected.lifecycle);
  try {
    await db.batch([guard, ...statements, db.prepare(CLEAR_SQL)]);
    return { kind: "ok" };
  } catch (error: unknown) {
    if (isGuardFailure(error)) {
      return { kind: "version_conflict" };
    }
    throw error;
  }
}
