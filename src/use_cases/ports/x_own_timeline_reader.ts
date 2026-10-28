import type { AccountId, XPostId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type { XResult } from "../../entities/x/x_failure";

/** One of the account's own posts, text with t.co links expanded from its entities (rev 4 M4). */
export interface XPostSummary {
  readonly id: XPostId;
  /** X's v2 `text` as returned: URLs as t.co links, a t.co link appended for media. */
  readonly text: string;
  readonly createdAt: Instant;
  readonly inReplyTo: XPostId | null;
}

/** One page of the account's own posts, newest first; `next` continues it, null on the last. */
export interface XPostsPage {
  readonly posts: readonly XPostSummary[];
  readonly next: string | null;
}

export interface XOwnTimelineReader {
  /**
   * The oldest `maxResults` of the account's own posts created at or after `since`, oldest first:
   * the posts right after an attempt, which reconcile looks for (pinned by the contract suite in
   * `tests/contract/x_ports.contract.ts`).
   */
  recent(
    account: AccountId,
    since: Instant,
    maxResults: number,
  ): Promise<XResult<readonly XPostSummary[]>>;
  /**
   * One page (up to 100) of the account's own posts created at or after `since`, newest first,
   * retweets left out; `token` is the previous page's `next` (null for the first). The import of
   * posts made outside GrokChat reads with it (GROKCHAT-19).
   */
  page(account: AccountId, since: Instant, token: string | null): Promise<XResult<XPostsPage>>;
}
