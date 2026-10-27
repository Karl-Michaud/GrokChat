import {
  MEDIA_CLEANUP_BATCH,
  MEDIA_CLEANUP_ITEM_COST,
  MEDIA_CLEANUP_QUERY_COST,
} from "../../entities/budget/budget";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { MediaBlobStore } from "../ports/media_blob_store";
import type { MediaCleanupCandidates } from "../ports/media_cleanup_candidates";
import type { MediaRepository } from "../ports/media_repository";
import type { MediaUsageRepository } from "../ports/media_usage_repository";

export interface MediaCleanupPorts {
  readonly media: MediaRepository;
  readonly candidates: MediaCleanupCandidates;
  readonly blobs: MediaBlobStore;
  readonly usage: MediaUsageRepository;
  readonly clock: Clock;
}

/**
 * Deletes staged media past its retention (plan §3.5); run by the metrics tick inside its budget
 * (U16): one query for at most as many due items as the meter still has room for, then each
 * item's declared cost checked before it and spent after it. What does not fit waits for the next
 * tick, oldest first, so every due item is reached.
 */
export class MediaCleanup {
  constructor(private readonly ports: MediaCleanupPorts) {}

  async run(meter: BudgetMeter): Promise<number> {
    const { media, candidates, blobs, usage, clock } = this.ports;
    const now = clock.now();
    const room = Math.floor(
      (meter.remaining().cloudflareCalls - MEDIA_CLEANUP_QUERY_COST.cloudflareCalls) /
        MEDIA_CLEANUP_ITEM_COST.cloudflareCalls,
    );
    const limit = Math.min(MEDIA_CLEANUP_BATCH, room);
    if (limit < 1 || !meter.fits(MEDIA_CLEANUP_QUERY_COST, now)) {
      return 0;
    }
    const due = await candidates.due(now, limit);
    meter.spend(MEDIA_CLEANUP_QUERY_COST);
    let deleted = 0;
    for (const item of due) {
      if (!meter.fits(MEDIA_CLEANUP_ITEM_COST, clock.now())) {
        break;
      }
      await blobs.delete(item.storageKey);
      await usage.record({ storedBytes: -item.size, classA: 0, classB: 0 }, now);
      await media.delete(item.id);
      meter.spend(MEDIA_CLEANUP_ITEM_COST);
      deleted += 1;
    }
    return deleted;
  }
}
