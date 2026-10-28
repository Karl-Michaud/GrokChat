import type { Actor } from "../../entities/identity/actor";
import type { PersonId } from "../../entities/identity/ids";

/** A new token for a person: generate, or rotate (the old one stops working). */
export interface IssuePersonTokenInputData {
  readonly actor: Actor;
  readonly personId: PersonId;
}
