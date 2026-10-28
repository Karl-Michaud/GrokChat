import type { MediaKind } from "../../entities/content/staged_media";
import type { StagedMediaId } from "../../entities/identity/ids";
import type { Refusal } from "../access/refusal";
import type { IntakeRefusalCode } from "../media/media_intake";

/** Every part is in: the file is staged media, ready for `create_post`'s media_ids. */
export interface UploadedMedia {
  readonly ok: true;
  readonly complete: true;
  readonly mediaId: StagedMediaId;
  readonly kind: MediaKind;
  readonly size: number;
  /** The multi-part upload it came from; null for a single-part upload. */
  readonly uploadId: string | null;
}

/** A part was stored; `missing` lists the part indexes still to send. */
export interface UploadInProgress {
  readonly ok: true;
  readonly complete: false;
  readonly uploadId: string;
  readonly missing: readonly number[];
}

/** A hash that does not match: what the bot declared and what its bytes hash to. */
export interface HashMismatch<Code extends string> extends Refusal<Code> {
  /** The part's index for `part_hash_mismatch`; null for the whole file. */
  readonly part: number | null;
  readonly expected: string;
  readonly actual: string;
}

export type UploadRefusalCode =
  | "not_found"
  | "scope"
  | "invalid_label"
  | "part_out_of_range"
  | "bad_base64"
  | "part_too_large"
  | "upload_not_found"
  | "upload_expired"
  | "upload_mismatch"
  | IntakeRefusalCode;

export type UploadMediaOutputData =
  | UploadedMedia
  | UploadInProgress
  | Refusal<UploadRefusalCode>
  | HashMismatch<"part_hash_mismatch" | "file_hash_mismatch">;
