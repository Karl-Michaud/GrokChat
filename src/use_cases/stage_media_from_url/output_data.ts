import type { MediaKind } from "../../entities/content/staged_media";
import type { StagedMediaId } from "../../entities/identity/ids";
import type { Refusal } from "../access/refusal";
import type { IntakeRefusalCode } from "../media/media_intake";
import type { FetchRefusal } from "../ports/media_fetcher";

export type StageMediaFromUrlOutputData =
  | {
      readonly ok: true;
      readonly mediaId: StagedMediaId;
      readonly kind: MediaKind;
      readonly size: number;
    }
  | Refusal<"not_found" | "scope" | Exclude<FetchRefusal, "host_not_allowed"> | IntakeRefusalCode>
  | HostRefusal;

/** A host refusal names the allowed hosts (config, not a secret), so a bot can say what to do. */
export interface HostRefusal extends Refusal<"host_not_allowed"> {
  readonly allowedHosts: readonly string[];
}
