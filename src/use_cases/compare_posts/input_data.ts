import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";
import type { MetricName } from "../../entities/metrics/metrics_snapshot";
import type { TimeWindow } from "../../entities/time/instant";

export interface ComparePostsInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly window: TimeWindow;
  readonly sortBy: MetricName;
}
