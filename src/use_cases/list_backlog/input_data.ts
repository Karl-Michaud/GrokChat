import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import type { TimeWindow } from "../../entities/time/instant";

export interface ListBacklogInputData {
  readonly actor: Actor;
  /** Null: every account the actor may see (a bot: its scope). */
  readonly accountId: AccountId | null;
  /** Null: every status. */
  readonly statuses: readonly DerivedStatus[] | null;
  /** Null: any publish time. */
  readonly window: TimeWindow | null;
}
