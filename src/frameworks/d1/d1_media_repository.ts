import {
  BOT_UPLOAD_SOURCE,
  DASHBOARD_SOURCE,
  type MediaKind,
  type MediaSource,
  type StagedMedia,
} from "../../entities/content/staged_media";
import { accountId, postId, stagedMediaId, type StagedMediaId } from "../../entities/identity/ids";
import type { MediaRepository } from "../../use_cases/ports/media_repository";

export interface MediaRow {
  readonly id: string;
  readonly owner_account_id: string;
  readonly kind: string;
  readonly content_type: string;
  readonly size: number;
  readonly storage_key: string;
  readonly sha256: string;
  readonly staged_at: number;
  readonly attached_to: string | null;
  readonly label: string | null;
  readonly source: string;
}

export const COLUMNS =
  "id, owner_account_id, kind, content_type, size, storage_key, sha256, staged_at, attached_to, label, source";

const URL_SOURCE = "url:";

const BOT_UPLOAD = "bot_upload";

/** `dashboard`, `url:<host>` (migration 0006), or `bot_upload` (GROKCHAT-20, no migration). */
export function sourceColumn(source: MediaSource): string {
  return source.kind === "url" ? `${URL_SOURCE}${source.host}` : source.kind;
}

export function sourceOf(column: string): MediaSource {
  if (column.startsWith(URL_SOURCE)) {
    return { kind: "url", host: column.slice(URL_SOURCE.length) };
  }
  return column === BOT_UPLOAD ? BOT_UPLOAD_SOURCE : DASHBOARD_SOURCE;
}

export function fromRow(row: MediaRow): StagedMedia {
  return {
    id: stagedMediaId(row.id),
    ownerAccountId: accountId(row.owner_account_id),
    kind: row.kind as MediaKind,
    contentType: row.content_type,
    size: row.size,
    storageKey: row.storage_key,
    sha256: row.sha256,
    stagedAt: row.staged_at,
    attachedTo: row.attached_to === null ? null : postId(row.attached_to),
    label: row.label,
    source: sourceOf(row.source),
  };
}

/** Staged-media metadata; the bytes are in R2 (`R2MediaBlobStore`). */
export class D1MediaRepository implements MediaRepository {
  constructor(private readonly db: D1Database) {}

  async get(id: StagedMediaId): Promise<StagedMedia | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM staged_media WHERE id = ?1`)
      .bind(id)
      .first<MediaRow>();
    return row === null ? null : fromRow(row);
  }

  async list(): Promise<readonly StagedMedia[]> {
    const result = await this.db
      .prepare(`SELECT ${COLUMNS} FROM staged_media ORDER BY id`)
      .all<MediaRow>();
    return result.results.map(fromRow);
  }

  async save(media: StagedMedia): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO staged_media (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(
        media.id,
        media.ownerAccountId,
        media.kind,
        media.contentType,
        media.size,
        media.storageKey,
        media.sha256,
        media.stagedAt,
        media.attachedTo,
        media.label,
        sourceColumn(media.source),
      )
      .run();
  }

  async delete(id: StagedMediaId): Promise<void> {
    await this.db.prepare("DELETE FROM staged_media WHERE id = ?1").bind(id).run();
  }
}
