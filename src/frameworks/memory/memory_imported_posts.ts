import type { AccountId, XPostId } from "../../entities/identity/ids";
import { metricsDue } from "../../entities/metrics/metrics_due";
import { importDue, type ImportedPost } from "../../entities/posts/imported_post";
import { inWindow, type Instant } from "../../entities/time/instant";
import type { AccountRepository } from "../../use_cases/ports/account_repository";
import type {
  ImportCursor,
  ImportedPostFilter,
  ImportedPostStore,
  ImportSchedule,
} from "../../use_cases/ports/imported_posts";
import type { MetricsRepository } from "../../use_cases/ports/metrics_repository";
import type { MemoryPostTable } from "./memory_post_store";

/** `imported_posts` and `post_imports` in memory (GROKCHAT-19). */
export class MemoryImportedPosts implements ImportedPostStore, ImportSchedule {
  readonly posts = new Map<XPostId, ImportedPost>();
  readonly cursors = new Map<AccountId, ImportCursor>();

  constructor(
    private readonly table: MemoryPostTable,
    private readonly accounts: AccountRepository,
    private readonly metrics: MetricsRepository,
  ) {}

  cursor(account: AccountId): Promise<ImportCursor> {
    return Promise.resolve(this.cursors.get(account) ?? { lastRunAt: null, newestCreatedAt: null });
  }

  add(posts: readonly ImportedPost[]): Promise<number> {
    const ours = this.publishedIds();
    let added = 0;
    for (const post of posts) {
      if (!this.posts.has(post.xPostId) && !ours.has(post.xPostId)) {
        this.posts.set(post.xPostId, post);
        added += 1;
      }
    }
    return Promise.resolve(added);
  }

  async finish(account: AccountId, at: Instant, newest: Instant | null): Promise<void> {
    const before = await this.cursor(account);
    this.cursors.set(account, {
      lastRunAt: at,
      newestCreatedAt: newest ?? before.newestCreatedAt,
    });
  }

  list(filter: ImportedPostFilter): Promise<readonly ImportedPost[]> {
    const ours = this.publishedIds();
    const window = filter.createdWindow;
    return Promise.resolve(
      [...this.posts.values()]
        .filter(
          (post) =>
            !ours.has(post.xPostId) &&
            (filter.accountIds?.includes(post.accountId) ?? true) &&
            (window === undefined || inWindow(window, post.createdAt)),
        )
        .sort((a, b) => a.createdAt - b.createdAt || a.xPostId.localeCompare(b.xPostId)),
    );
  }

  async accountsDue(now: Instant): Promise<readonly AccountId[]> {
    const connected = (await this.accounts.list()).filter(
      (account) => account.status === "ACTIVE" || account.status === "PAUSED",
    );
    const importing = connected
      .map((account) => account.id)
      .filter((id) => importDue(this.cursors.get(id)?.lastRunAt ?? null, now));
    const imported = await this.list({});
    const latest = await this.metrics.latest(imported.map((post) => post.xPostId));
    const taken = new Map(latest.map((snapshot) => [snapshot.xPostId, snapshot.takenAt]));
    const measuring = imported
      .filter((post) => metricsDue(post.createdAt, taken.get(post.xPostId) ?? null, now))
      .map((post) => post.accountId);
    return [...new Set([...importing, ...measuring])].sort();
  }

  /** The X ids of every SENT or DELETED part GrokChat published. */
  private publishedIds(): ReadonlySet<XPostId> {
    return new Set(
      this.table
        .all()
        .flatMap((post) =>
          post.parts.flatMap((part) =>
            part.state.kind === "SENT" || part.state.kind === "DELETED" ? [part.state.xPostId] : [],
          ),
        ),
    );
  }
}
