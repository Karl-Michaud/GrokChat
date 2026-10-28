import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

/** One `upload_media` call (GROKCHAT-20): the whole file, or one part of it. */
export interface UploadMediaInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  /** As the bot sent it; trimmed, at most 80 characters (`parseMediaLabel`). */
  readonly label: string;
  /** The whole file's SHA-256, lowercase hex (on every part). */
  readonly fileSha256: string;
  /** This part's bytes, standard base64. */
  readonly data: string;
  /** This part's decoded bytes' SHA-256, lowercase hex. */
  readonly partSha256: string;
  /** Null for a single-part upload and for the first part sent of a multi-part one. */
  readonly uploadId: string | null;
  /** From 0. */
  readonly partIndex: number;
  readonly partCount: number;
}
