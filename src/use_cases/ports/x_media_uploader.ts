import type { MediaKind } from "../../entities/content/staged_media";
import type { AccountId, XMediaId } from "../../entities/identity/ids";
import type { XResult } from "../../entities/x/x_failure";

/** Simple upload for photos, chunked for GIFs (plan §1.1). */
export interface XMediaUploader {
  upload(account: AccountId, bytes: Uint8Array, kind: MediaKind): Promise<XResult<XMediaId>>;
}
