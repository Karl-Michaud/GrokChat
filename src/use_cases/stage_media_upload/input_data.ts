import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

export interface StageMediaUploadInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly bytes: Uint8Array;
}
