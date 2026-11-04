import type { AccountId, PostId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";

/** What one publish call did for an account. */
export interface PublishSummary {
  /** False when `publishNow` could not take the publish lock before its deadline. */
  readonly ran: boolean;
  readonly sent: number;
  readonly touched: readonly PostId[];
  /** An app-scope 429: the tick stops dispatching (plan §3.1.1). */
  readonly appRateLimited: boolean;
}

/** The port to the account's Durable Object, which runs `PublishPost` under its publish lock. */
export interface AccountPublisher {
  publishDue(account: AccountId, now: Instant, deadline: Instant): Promise<PublishSummary>;
  publishNow(account: AccountId, post: PostId, deadline: Instant): Promise<PublishSummary>;
}
