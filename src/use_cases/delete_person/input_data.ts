import type { Actor } from "../../entities/identity/actor";
import type { PersonId } from "../../entities/identity/ids";

/** Deletes a person; `confirmation` must be their name, typed again. */
export interface DeletePersonInputData {
  readonly actor: Actor;
  readonly personId: PersonId;
  readonly confirmation: string;
}
