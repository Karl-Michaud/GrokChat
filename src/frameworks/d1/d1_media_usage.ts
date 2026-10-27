import { monthKey, usageAt, type MediaUsage } from "../../entities/media/r2_quota";
import type { Instant } from "../../entities/time/instant";
import type {
  MediaUsageDelta,
  MediaUsageRepository,
} from "../../use_cases/ports/media_usage_repository";

interface UsageRow {
  readonly month: string;
  readonly stored_bytes: number;
  readonly class_a: number;
  readonly class_b: number;
}

/**
 * R2 use for the quota guard (plan §3.5), one row. A delta is one atomic upsert: a write in a new
 * month starts that month's operation counts again, while stored bytes carry over.
 */
const RECORD_SQL =
  "INSERT INTO r2_usage (id, month, stored_bytes, class_a, class_b) VALUES (1, ?1, ?2, ?3, ?4) " +
  "ON CONFLICT (id) DO UPDATE SET " +
  "stored_bytes = stored_bytes + excluded.stored_bytes, " +
  "class_a = CASE WHEN month = excluded.month THEN class_a + excluded.class_a ELSE excluded.class_a END, " +
  "class_b = CASE WHEN month = excluded.month THEN class_b + excluded.class_b ELSE excluded.class_b END, " +
  "month = excluded.month";

export class D1MediaUsage implements MediaUsageRepository {
  constructor(private readonly db: D1Database) {}

  async current(now: Instant): Promise<MediaUsage> {
    const row = await this.db
      .prepare("SELECT month, stored_bytes, class_a, class_b FROM r2_usage WHERE id = 1")
      .first<UsageRow>();
    const stored: MediaUsage =
      row === null
        ? { month: monthKey(now), storedBytes: 0, classA: 0, classB: 0 }
        : {
            month: row.month,
            storedBytes: row.stored_bytes,
            classA: row.class_a,
            classB: row.class_b,
          };
    return usageAt(stored, now);
  }

  async record(delta: MediaUsageDelta, now: Instant): Promise<void> {
    await this.db
      .prepare(RECORD_SQL)
      .bind(monthKey(now), delta.storedBytes, delta.classA, delta.classB)
      .run();
  }
}
