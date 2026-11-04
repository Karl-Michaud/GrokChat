import type { MediaUsage } from "../../entities/media/r2_quota";
import type { Instant } from "../../entities/time/instant";

export interface MediaUsageDelta {
  readonly storedBytes: number;
  readonly classA: number;
  readonly classB: number;
}

/** R2 use this month, kept in D1 for the quota guard (plan §3.5). */
export interface MediaUsageRepository {
  current(now: Instant): Promise<MediaUsage>;
  record(delta: MediaUsageDelta, now: Instant): Promise<void>;
}
