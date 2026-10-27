import type { AccountId, BotId, IdempotencyKey, PostId } from "../../entities/identity/ids";
import { metricsDue } from "../../entities/metrics/metrics_due";
import { isDue, dueAt } from "../../entities/posts/due";
import type { Lifecycle, Post } from "../../entities/posts/post";
import { activityOf, type RecentActivity } from "../../entities/policy/recent_activity";
import type { AuditEvent } from "../../entities/records/audit_event";
import type { CostEntry } from "../../entities/records/cost_entry";
import { inWindow, type Instant } from "../../entities/time/instant";
import type { AuditLog } from "../../use_cases/ports/audit_log";
import type { CostLedger } from "../../use_cases/ports/cost_ledger";
import type { MetricsRepository } from "../../use_cases/ports/metrics_repository";
import type { AccountWork, PostFilter, PostReader } from "../../use_cases/ports/post_reader";
import type { AddResult, PostWriter, SaveResult } from "../../use_cases/ports/post_writer";
import type { PublishingCount } from "../../use_cases/ports/publishing_count";

/** The posts table, shared by the in-memory reader and writer. */
export class MemoryPostTable {
  readonly rows = new Map<PostId, Post>();

  all(): readonly Post[] {
    return [...this.rows.values()];
  }
}

function matches(post: Post, filter: PostFilter): boolean {
  const accounts = filter.accountIds ?? [post.accountId];
  const lifecycles = filter.lifecycles ?? [post.lifecycle];
  const states = filter.partStates;
  const window = filter.publishWindow;
  const dueBy = filter.dueBy;
  return (
    accounts.includes(post.accountId) &&
    lifecycles.includes(post.lifecycle) &&
    (states === undefined || post.parts.some((part) => states.includes(part.state.kind))) &&
    (window === undefined || inWindow(window, post.publishAt)) &&
    (dueBy === undefined || isDue(post, dueBy))
  );
}

const ORDER = (a: Post, b: Post): number => a.publishAt - b.publishAt || a.id.localeCompare(b.id);

export class MemoryPostReader implements PostReader, PublishingCount {
  constructor(
    private readonly table: MemoryPostTable,
    private readonly metrics: MetricsRepository,
  ) {}

  get(id: PostId): Promise<Post | null> {
    return Promise.resolve(this.table.rows.get(id) ?? null);
  }

  findByIdempotency(bot: BotId, key: IdempotencyKey): Promise<Post | null> {
    const found = this.table
      .all()
      .find((post) => post.provenance.botId === bot && post.idempotencyKey === key);
    return Promise.resolve(found ?? null);
  }

  publishingCount(): Promise<number> {
    return Promise.resolve(this.table.all().filter((p) => p.lifecycle === "PUBLISHING").length);
  }

  list(filter: PostFilter): Promise<readonly Post[]> {
    return Promise.resolve(
      this.table
        .all()
        .filter((post) => matches(post, filter))
        .sort(ORDER),
    );
  }

  recentActivity(account: AccountId): Promise<RecentActivity> {
    return Promise.resolve(
      activityOf(this.table.all().filter((post) => post.accountId === account)),
    );
  }

  async accountsNeedingWork(now: Instant): Promise<readonly AccountWork[]> {
    const accounts = [...new Set(this.table.all().map((post) => post.accountId))];
    const work = await Promise.all(accounts.map((account) => this.workFor(account, now)));
    return work
      .filter((item) => item.publish || item.reconcile || item.metrics)
      .sort((a, b) => a.oldestDueAt - b.oldestDueAt || a.accountId.localeCompare(b.accountId));
  }

  private async workFor(account: AccountId, now: Instant): Promise<AccountWork> {
    const posts = this.table.all().filter((post) => post.accountId === account);
    const due = posts.filter((post) => isDue(post, now) || post.lifecycle === "PUBLISHING");
    const sent = posts.flatMap((post) =>
      post.parts.flatMap((part) => (part.state.kind === "SENT" ? [part.state] : [])),
    );
    const latest = await this.metrics.latest(sent.map((state) => state.xPostId));
    const taken = new Map(latest.map((snapshot) => [snapshot.xPostId, snapshot.takenAt]));
    return {
      accountId: account,
      oldestDueAt: Math.min(now, ...due.map((post) => dueAt(post) ?? now)),
      publish: due.length > 0,
      reconcile: posts.some((post) => post.parts.some((part) => part.state.kind === "UNKNOWN")),
      metrics: sent.some((state) => metricsDue(state.at, taken.get(state.xPostId) ?? null, now)),
    };
  }
}

export class MemoryPostWriter implements PostWriter {
  constructor(
    private readonly table: MemoryPostTable,
    private readonly audit: AuditLog,
    private readonly costs: CostLedger,
  ) {}

  add(post: Post): Promise<AddResult> {
    const bot = post.provenance.botId;
    const existing = this.table
      .all()
      .find(
        (row) =>
          bot !== null &&
          row.provenance.botId === bot &&
          row.idempotencyKey === post.idempotencyKey,
      );
    if (existing !== undefined && post.idempotencyKey !== null) {
      return Promise.resolve({ kind: "duplicate", existing });
    }
    this.table.rows.set(post.id, post);
    return Promise.resolve({ kind: "added" });
  }

  save(post: Post, expectedVersion: number, expectedLifecycle: Lifecycle): Promise<SaveResult> {
    const stored = this.table.rows.get(post.id);
    if (stored?.version !== expectedVersion || stored.lifecycle !== expectedLifecycle) {
      return Promise.resolve({ kind: "version_conflict" });
    }
    this.table.rows.set(post.id, post);
    return Promise.resolve({ kind: "ok" });
  }

  async commitPart(
    post: Post,
    expectedVersion: number,
    expectedLifecycle: Lifecycle,
    audit: AuditEvent,
    cost: CostEntry,
  ): Promise<SaveResult> {
    const saved = await this.save(post, expectedVersion, expectedLifecycle);
    if (saved.kind === "ok") {
      await this.audit.append(audit);
      await this.costs.append(cost);
    }
    return saved;
  }
}
