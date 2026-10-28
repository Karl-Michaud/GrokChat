import { UPLOAD_CLEANUP_ITEM_COST, UPLOAD_CLEANUP_QUERY_COST } from "../../entities/budget/budget";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { ExpiredUploads } from "../ports/expired_uploads";
import type { MediaUsageRepository } from "../ports/media_usage_repository";
import type { CleanupStep } from "./cleanup_step";

/** At most this many expired uploads per tick; the rest wait for the next. */
export const UPLOAD_CLEANUP_BATCH = 20;

export interface UploadCleanupPorts {
  readonly uploads: ExpiredUploads;
  readonly usage: MediaUsageRepository;
  readonly clock: Clock;
}

/**
 * Deletes the parts of `upload_media` uploads past their expiry (GROKCHAT-20), inside the metrics
 * tick's budget like the staged-media cleanup: one listing, then each upload's declared cost
 * checked before it and spent after it, its bytes taken off the R2 usage.
 */
export class UploadCleanup implements CleanupStep {
  constructor(private readonly ports: UploadCleanupPorts) {}

  async run(meter: BudgetMeter): Promise<number> {
    const { uploads, usage, clock } = this.ports;
    const now = clock.now();
    if (!meter.fits(UPLOAD_CLEANUP_QUERY_COST, now)) {
      return 0;
    }
    const due = await uploads.expired(now, UPLOAD_CLEANUP_BATCH);
    meter.spend(UPLOAD_CLEANUP_QUERY_COST);
    await usage.record({ storedBytes: 0, classA: 1, classB: 0 }, now);
    let deleted = 0;
    for (const upload of due) {
      if (!meter.fits(UPLOAD_CLEANUP_ITEM_COST, clock.now())) {
        break;
      }
      await uploads.discard(upload.id);
      await usage.record({ storedBytes: -upload.partBytes, classA: 1, classB: 0 }, now);
      meter.spend(UPLOAD_CLEANUP_ITEM_COST);
      deleted += 1;
    }
    return deleted;
  }
}
