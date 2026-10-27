import type { BotId, IdempotencyKey, AccountId, PostId } from "../../entities/identity/ids";
import type { PartStateKind } from "../../entities/posts/part_state";
import type { Lifecycle, Post } from "../../entities/posts/post";
import type { RecentActivity } from "../../entities/policy/recent_activity";
import type { Instant, TimeWindow } from "../../entities/time/instant";

/** Every field narrows the list; an empty filter lists every post. */
export interface PostFilter {
  readonly accountIds?: readonly AccountId[];
  readonly lifecycles?: readonly Lifecycle[];
  /** Posts with at least one part in one of these states. */
  readonly partStates?: readonly PartStateKind[];
  /** Posts whose publishAt falls in the window. */
  readonly publishWindow?: TimeWindow;
  /** Waiting posts due by then: SCHEDULED with publishAt, RESUMING with resumeAt, at or before it. */
  readonly dueBy?: Instant;
}

/** An account that a cron tick has work for (plan §3.2, A3). */
export interface AccountWork {
  readonly accountId: AccountId;
  /** The oldest due time among its due posts: the tick dispatches oldest first. */
  readonly oldestDueAt: Instant;
  /** A post due (SCHEDULED or RESUMING past its time) or one left PUBLISHING. */
  readonly publish: boolean;
  /** A part with an UNKNOWN outcome. */
  readonly reconcile: boolean;
  /** A sent part whose metrics are due. */
  readonly metrics: boolean;
}

export interface PostReader {
  get(id: PostId): Promise<Post | null>;
  findByIdempotency(bot: BotId, key: IdempotencyKey): Promise<Post | null>;
  /** Ordered by publishAt, then id. */
  list(filter: PostFilter): Promise<readonly Post[]>;
  /** The account's posts with a part SENDING, SENT or UNKNOWN (what the cap and gap count). */
  recentActivity(account: AccountId, now: Instant): Promise<RecentActivity>;
  /** One indexed query: accounts with work, oldest due first. */
  accountsNeedingWork(now: Instant): Promise<readonly AccountWork[]>;
}
