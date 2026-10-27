import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

export interface StageMediaFromUrlInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly url: string;
}
