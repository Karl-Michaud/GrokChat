import type { Actor } from "../../entities/identity/actor";
import type { PersonId } from "../../entities/identity/ids";

/** A new name for a person. */
export interface RenamePersonInputData {
  readonly actor: Actor;
  readonly personId: PersonId;
  readonly name: string;
}
