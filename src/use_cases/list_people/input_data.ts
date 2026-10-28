import type { Actor } from "../../entities/identity/actor";

/** The dashboard's people, with their accounts. */
export interface ListPeopleInputData {
  readonly actor: Actor;
}
