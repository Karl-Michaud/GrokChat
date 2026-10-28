import type { MediaKind } from "../../entities/content/staged_media";
import type { StagedMediaId } from "../../entities/identity/ids";
import type { Refusal } from "../access/refusal";
import type { IntakeRefusalCode } from "../media/media_intake";

export type StageMediaUploadOutputData =
  | {
      readonly ok: true;
      readonly mediaId: StagedMediaId;
      readonly kind: MediaKind;
      readonly size: number;
    }
  | Refusal<"not_found" | "human_only" | "invalid_label" | IntakeRefusalCode>;
