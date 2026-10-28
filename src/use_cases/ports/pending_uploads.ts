import type { AccountId, StagedMediaId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";

/** A multi-part `upload_media` in progress (GROKCHAT-20): what every later part must match. */
export interface PendingUpload {
  readonly id: string;
  readonly accountId: AccountId;
  /** The whole file's SHA-256, lowercase hex, as the bot declared it on the first part. */
  readonly fileSha256: string;
  readonly partCount: number;
  readonly label: string | null;
  readonly expiresAt: Instant;
  /** The staged media once every part was in and stored; null while parts are missing. */
  readonly mediaId: StagedMediaId | null;
}

/** A part as stored: its index (from 0), its bytes' SHA-256 (lowercase hex) and size. */
export interface StoredPart {
  readonly index: number;
  readonly sha256: string;
  readonly size: number;
}

/**
 * The parts of unfinished uploads (R2, under a temporary prefix; no D1 row). Writing a part again
 * replaces it, so a resent part is idempotent.
 */
export interface PendingUploads {
  open(upload: PendingUpload): Promise<void>;
  get(id: string): Promise<PendingUpload | null>;
  putPart(upload: PendingUpload, part: StoredPart, bytes: Uint8Array): Promise<void>;
  /** The parts stored so far, by index. */
  parts(id: string): Promise<readonly StoredPart[]>;
  readPart(id: string, index: number): Promise<Uint8Array | null>;
  /** Deletes the parts and keeps the upload, marked with its media, until it expires. */
  finish(id: string, mediaId: StagedMediaId): Promise<void>;
  /** Deletes the upload and its parts. */
  discard(id: string): Promise<void>;
}
