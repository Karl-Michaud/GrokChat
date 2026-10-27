import type { Actor } from "../../entities/identity/actor";
import { accountId, idempotencyKey, postId } from "../../entities/identity/ids";
import { attemptTime } from "../../entities/posts/part_state";
import { dueAt } from "../../entities/posts/due";
import type { Lifecycle, Post, PostPart, Provenance } from "../../entities/posts/post";
import { nextMetricsAtSql } from "./metrics_next";

/** A `posts` row. `parts` is the source of truth; `post_parts` is its index. */
export interface PostRow {
  readonly id: string;
  readonly account_id: string;
  readonly lifecycle: string;
  readonly publish_at: number;
  readonly resume_at: number | null;
  readonly due_at: number | null;
  readonly bot_id: string | null;
  readonly idempotency_key: string | null;
  readonly request_hash: string;
  readonly created_by: string;
  readonly provenance: string;
  readonly parts: string;
  readonly version: number;
}

export const POST_COLUMNS =
  "id, account_id, lifecycle, publish_at, resume_at, due_at, bot_id, idempotency_key, " +
  "request_hash, created_by, provenance, parts, version";

export function postFromRow(row: PostRow): Post {
  return {
    id: postId(row.id),
    accountId: accountId(row.account_id),
    parts: JSON.parse(row.parts) as readonly PostPart[],
    lifecycle: row.lifecycle as Lifecycle,
    publishAt: row.publish_at,
    resumeAt: row.resume_at,
    idempotencyKey: row.idempotency_key === null ? null : idempotencyKey(row.idempotency_key),
    requestHash: row.request_hash,
    createdBy: JSON.parse(row.created_by) as Actor,
    provenance: JSON.parse(row.provenance) as Provenance,
    version: row.version,
  };
}

/** The values of `POST_COLUMNS`, in order. */
function postValues(post: Post): readonly (string | number | null)[] {
  return [
    post.id,
    post.accountId,
    post.lifecycle,
    post.publishAt,
    post.resumeAt,
    dueAt(post),
    post.provenance.botId,
    post.idempotencyKey,
    post.requestHash,
    JSON.stringify(post.createdBy),
    JSON.stringify(post.provenance),
    JSON.stringify(post.parts),
    post.version,
  ];
}

const PLACEHOLDERS = Array.from({ length: 13 }, (_, index) => `?${String(index + 1)}`).join(", ");

export function insertPost(db: D1Database, post: Post): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO posts (${POST_COLUMNS}) VALUES (${PLACEHOLDERS})`)
    .bind(...postValues(post));
}

const UPDATE_SET = POST_COLUMNS.split(", ")
  .slice(1)
  .map((column, index) => `${column} = ?${String(index + 2)}`)
  .join(", ");

export function updatePost(db: D1Database, post: Post): D1PreparedStatement {
  return db.prepare(`UPDATE posts SET ${UPDATE_SET} WHERE id = ?1`).bind(...postValues(post));
}

const INSERT_PART =
  "INSERT INTO post_parts (post_id, idx, account_id, state_kind, attempt_at, x_post_id, " +
  `sent_at, metrics_next_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ${nextMetricsAtSql("?7", "last.taken")} ` +
  "FROM (SELECT MAX(taken_at) AS taken FROM metrics WHERE x_post_id = ?6) AS last";

function insertPart(
  db: D1Database,
  post: Post,
  part: PostPart,
  index: number,
): D1PreparedStatement {
  const { state } = part;
  const sent = state.kind === "SENT" ? state : null;
  return db
    .prepare(INSERT_PART)
    .bind(
      post.id,
      index,
      post.accountId,
      state.kind,
      attemptTime(state),
      sent?.xPostId ?? null,
      sent?.at ?? null,
    );
}

/** Replaces the post's index rows: the part count can change with an edit. */
export function partStatements(db: D1Database, post: Post): readonly D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM post_parts WHERE post_id = ?1").bind(post.id),
    ...post.parts.map((part, index) => insertPart(db, post, part, index)),
  ];
}
