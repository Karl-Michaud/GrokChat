import type { PostFilter } from "../../use_cases/ports/post_reader";

export interface SqlWhere {
  readonly sql: string;
  readonly params: readonly (string | number)[];
}

/** An id list is bound as one JSON parameter, so a filter never runs into D1's 100-parameter cap. */
const IN_JSON = "IN (SELECT value FROM json_each(?))";

/** `PostReader.list`'s filter as a WHERE clause over `posts` (every field narrows; none: all). */
export function postFilterSql(filter: PostFilter): SqlWhere {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const add = (clause: string, ...values: readonly (string | number)[]): void => {
    clauses.push(clause);
    params.push(...values);
  };
  if (filter.accountIds !== undefined) {
    add(`account_id ${IN_JSON}`, JSON.stringify(filter.accountIds));
  }
  if (filter.lifecycles !== undefined) {
    add(`lifecycle ${IN_JSON}`, JSON.stringify(filter.lifecycles));
  }
  if (filter.partStates !== undefined) {
    add(
      `EXISTS (SELECT 1 FROM post_parts WHERE post_parts.post_id = posts.id AND state_kind ${IN_JSON})`,
      JSON.stringify(filter.partStates),
    );
  }
  if (filter.publishWindow !== undefined) {
    add("publish_at >= ? AND publish_at < ?", filter.publishWindow.from, filter.publishWindow.to);
  }
  if (filter.dueBy !== undefined) {
    // due_at is set only for waiting posts (SCHEDULED, RESUMING): entities/posts/due.
    add("due_at <= ?", filter.dueBy);
  }
  return { sql: clauses.length === 0 ? "1 = 1" : clauses.join(" AND "), params };
}
