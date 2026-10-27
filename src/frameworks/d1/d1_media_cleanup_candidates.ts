import type { StagedMedia } from "../../entities/content/staged_media";
import { KEEP_AFTER_DONE, KEEP_UNUSED } from "../../entities/media/media_cleanup";
import type { Instant } from "../../entities/time/instant";
import type { MediaCleanupCandidates } from "../../use_cases/ports/media_cleanup_candidates";
import { COLUMNS, fromRow, type MediaRow } from "./d1_media_repository";

const MEDIA_COLUMNS = COLUMNS.split(", ")
  .map((column) => `m.${column}`)
  .join(", ");

/**
 * `mediaCleanupDue` in SQL (the differential test checks it against the entity): an item whose
 * post is gone, cancelled or missed (or that never had one) 2 days after staging; an item of a
 * DONE post 7 days after the later of its staging and the post's last sent part.
 */
const DUE_SQL =
  `SELECT ${MEDIA_COLUMNS} FROM staged_media AS m LEFT JOIN posts AS p ON p.id = m.attached_to ` +
  "WHERE ((p.id IS NULL OR p.lifecycle IN ('CANCELLED', 'MISSED')) " +
  `AND m.staged_at <= ?1 - ${String(KEEP_UNUSED)}) ` +
  "OR (p.lifecycle = 'DONE' AND MAX(m.staged_at, COALESCE((SELECT MAX(pp.sent_at) " +
  "FROM post_parts AS pp WHERE pp.post_id = p.id AND pp.state_kind = 'SENT'), m.staged_at)) " +
  `<= ?1 - ${String(KEEP_AFTER_DONE)}) ` +
  "ORDER BY m.staged_at, m.id LIMIT ?2";

/** The cleanup's one query per tick: only due items, so items still kept cost nothing. */
export class D1MediaCleanupCandidates implements MediaCleanupCandidates {
  constructor(private readonly db: D1Database) {}

  async due(now: Instant, limit: number): Promise<readonly StagedMedia[]> {
    const result = await this.db.prepare(DUE_SQL).bind(now, Math.max(0, limit)).all<MediaRow>();
    return result.results.map(fromRow);
  }
}
