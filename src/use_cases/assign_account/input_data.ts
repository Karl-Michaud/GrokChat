import type { Actor } from "../../entities/identity/actor";
import type { AccountId, PersonId } from "../../entities/identity/ids";

/** Gives an account to a person, or to nobody (null). */
export interface AssignAccountInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly personId: PersonId | null;
}
