import type { StagedMedia } from "../../entities/content/staged_media";
import type { AccountId } from "../../entities/identity/ids";
import type { MediaCatalog } from "../../use_cases/ports/media_catalog";
import { COLUMNS, fromRow, type MediaRow } from "./d1_media_repository";

/** An account's recent staged media, through the `staged_media_owner` index (migration 0005). */
export class D1MediaCatalog implements MediaCatalog {
  constructor(private readonly db: D1Database) {}

  async recent(account: AccountId, limit: number): Promise<readonly StagedMedia[]> {
    const result = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM staged_media WHERE owner_account_id = ?1 ` +
          "ORDER BY staged_at DESC, id DESC LIMIT ?2",
      )
      .bind(account, Math.max(0, limit))
      .all<MediaRow>();
    return result.results.map(fromRow);
  }
}
