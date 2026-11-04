import type { AnalyticsRange } from "../../entities/analytics/range";
import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

export interface GetAnalyticsInputData {
  readonly actor: Actor;
  readonly range: AnalyticsRange;
  /** Null: every account together, with the per-account breakdown. */
  readonly accountId: AccountId | null;
}
