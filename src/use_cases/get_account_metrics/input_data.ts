import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";
import type { TimeWindow } from "../../entities/time/instant";

export interface GetAccountMetricsInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly window: TimeWindow;
}
