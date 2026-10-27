import type { StagedMedia } from "../../entities/content/staged_media";
import type { Instant } from "../../entities/time/instant";

/** The staged media whose retention has passed (plan §3.5), selected in one query. */
export interface MediaCleanupCandidates {
  /**
   * At most `limit` items for which `mediaCleanupDue` holds at `now` (their attached post, if it
   * still exists, decides), oldest staged first, then by id. Items not yet due are never returned.
   */
  due(now: Instant, limit: number): Promise<readonly StagedMedia[]>;
}
