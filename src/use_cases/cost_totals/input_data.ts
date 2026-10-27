import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";
import type { TimeWindow } from "../../entities/time/instant";

export interface CostTotalsInputData {
  readonly actor: Actor;
  readonly window: TimeWindow;
  /** Null: every account. */
  readonly accountId: AccountId | null;
}
