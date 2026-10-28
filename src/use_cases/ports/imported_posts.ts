import type { AccountId } from "../../entities/identity/ids";
import type { ImportedPost } from "../../entities/posts/imported_post";
import type { Instant, TimeWindow } from "../../entities/time/instant";

/** Where an account's imports stand: null for both until its first import finishes. */
export interface ImportCursor {
  readonly lastRunAt: Instant | null;
  /** The newest post's creation time seen by any import. */
  readonly newestCreatedAt: Instant | null;
}

export interface ImportedPostFilter {
  /** Absent: every account. */
  readonly accountIds?: readonly AccountId[];
  /** Posts created in it; absent: any time. */
  readonly createdWindow?: TimeWindow;
}

/** `imported_posts` and `post_imports` (GROKCHAT-19). */
export interface ImportedPostStore {
  cursor(account: AccountId): Promise<ImportCursor>;
  /**
   * Stores the posts, skipping any already stored and any GrokChat published itself (a SENT or
   * DELETED part with that X id); returns how many were new.
   */
  add(posts: readonly ImportedPost[]): Promise<number>;
  /** Records a finished import at `at`; a null `newest` keeps the newest seen so far. */
  finish(account: AccountId, at: Instant, newest: Instant | null): Promise<void>;
  /**
   * Imported posts, oldest first, leaving out any whose X id a GrokChat part now has (one found
   * before its send was committed or reconciled), so no post is counted twice.
   */
  list(filter: ImportedPostFilter): Promise<readonly ImportedPost[]>;
}

/** Which accounts the metrics tick should visit for imports and imported posts' metrics. */
export interface ImportSchedule {
  /**
   * Connected accounts (ACTIVE or PAUSED) whose import is due at `now`, and accounts with an
   * imported post whose next metrics read has passed, by account id.
   */
  accountsDue(now: Instant): Promise<readonly AccountId[]>;
}
