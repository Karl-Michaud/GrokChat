import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

export interface GetPersonalityInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
}
