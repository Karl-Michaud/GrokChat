import type { Lifecycle, Post } from "../../entities/posts/post";
import type { AuditEvent } from "../../entities/records/audit_event";
import type { CostEntry } from "../../entities/records/cost_entry";
import type { PostReader } from "../../use_cases/ports/post_reader";
import type { AddResult, PostWriter, SaveResult } from "../../use_cases/ports/post_writer";
import { auditInsert } from "./d1_audit_log";
import { costInsert } from "./d1_cost_ledger";
import { insertPost, partStatements, updatePost } from "./post_rows";
import { guardedBatch } from "./version_guard";

/** What D1 reports for a second post with the same (bot, idempotency key). */
const DUPLICATE_KEY = "UNIQUE constraint failed: posts.bot_id, posts.idempotency_key";

function isDuplicateKey(error: unknown): boolean {
  return error instanceof Error && error.message.includes(DUPLICATE_KEY);
}

/**
 * Every write is one D1 batch, so a post and its part index never disagree. `save` and
 * `commitPart` start with the raising version guard (plan §3.5, R21); `add` relies on the unique
 * (bot_id, idempotency_key) index, so two concurrent creates with one key make one post (R14).
 */
export class D1PostWriter implements PostWriter {
  constructor(
    private readonly db: D1Database,
    private readonly reader: PostReader,
  ) {}

  async add(post: Post): Promise<AddResult> {
    try {
      await this.db.batch([insertPost(this.db, post), ...partStatements(this.db, post)]);
      return { kind: "added" };
    } catch (error: unknown) {
      const { botId } = post.provenance;
      if (!isDuplicateKey(error) || botId === null || post.idempotencyKey === null) {
        throw error;
      }
      const existing = await this.reader.findByIdempotency(botId, post.idempotencyKey);
      if (existing === null) {
        throw error;
      }
      return { kind: "duplicate", existing };
    }
  }

  save(post: Post, expectedVersion: number, expectedLifecycle: Lifecycle): Promise<SaveResult> {
    return guardedBatch(
      this.db,
      { id: post.id, version: expectedVersion, lifecycle: expectedLifecycle },
      this.postStatements(post),
    );
  }

  commitPart(
    post: Post,
    expectedVersion: number,
    expectedLifecycle: Lifecycle,
    audit: AuditEvent,
    cost: CostEntry,
  ): Promise<SaveResult> {
    return guardedBatch(
      this.db,
      { id: post.id, version: expectedVersion, lifecycle: expectedLifecycle },
      [...this.postStatements(post), auditInsert(this.db, audit), costInsert(this.db, cost)],
    );
  }

  private postStatements(post: Post): readonly D1PreparedStatement[] {
    return [updatePost(this.db, post), ...partStatements(this.db, post)];
  }
}
