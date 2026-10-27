import type { AccountId, XPostId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type { XResult } from "../../entities/x/x_failure";

/** One of the account's own posts, text with t.co links expanded from its entities (rev 4 M4). */
export interface XPostSummary {
  readonly id: XPostId;
  readonly text: string;
  readonly createdAt: Instant;
  readonly inReplyTo: XPostId | null;
}

export interface XOwnTimelineReader {
  recent(
    account: AccountId,
    since: Instant,
    maxResults: number,
  ): Promise<XResult<readonly XPostSummary[]>>;
}
