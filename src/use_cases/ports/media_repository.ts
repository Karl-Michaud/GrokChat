import type { StagedMedia } from "../../entities/content/staged_media";
import type { StagedMediaId } from "../../entities/identity/ids";

/** Staged-media metadata (D1); the bytes are in the `MediaBlobStore`. */
export interface MediaRepository {
  get(id: StagedMediaId): Promise<StagedMedia | null>;
  list(): Promise<readonly StagedMedia[]>;
  save(media: StagedMedia): Promise<void>;
  delete(id: StagedMediaId): Promise<void>;
}
