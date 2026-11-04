import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

export interface StageMediaUploadInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  /** As typed on the dashboard; trimmed, at most 80 characters (`parseMediaLabel`). */
  readonly label: string;
  readonly bytes: Uint8Array;
}
