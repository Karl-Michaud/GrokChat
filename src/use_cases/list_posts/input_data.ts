import type { PostSortKey, SortDirection } from "../../entities/analytics/post_sort";
import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import type { TimeWindow } from "../../entities/time/instant";

export interface ListPostsInputData {
  readonly actor: Actor;
  /** Null: every account. */
  readonly accountId: AccountId | null;
  /** Null: every status. */
  readonly statuses: readonly DerivedStatus[] | null;
  /** Posts whose publish time falls in it; null: any time. */
  readonly window: TimeWindow | null;
  readonly sort: PostSortKey;
  readonly direction: SortDirection;
  /** 1-based; past the last page shows the last page. */
  readonly page: number;
  readonly pageSize: number;
}
