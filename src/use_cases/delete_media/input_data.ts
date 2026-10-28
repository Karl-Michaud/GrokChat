import type { Actor } from "../../entities/identity/actor";
import type { StagedMediaId } from "../../entities/identity/ids";

export interface DeleteMediaInputData {
  readonly actor: Actor;
  readonly mediaId: StagedMediaId;
}
