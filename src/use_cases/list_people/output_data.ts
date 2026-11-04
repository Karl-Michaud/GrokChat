import type { AccountId } from "../../entities/identity/ids";
import type { Person } from "../../entities/people/person";
import type { Refusal } from "../access/refusal";
/** One person and the ids of the accounts assigned to them, by id. */
export interface PersonListing {
  readonly person: Person;
  readonly accountIds: readonly AccountId[];
}

/** Every person, by name (GROKCHAT-16); never a token, only whether one is set and when. */
export type ListPeopleOutputData =
  { readonly ok: true; readonly people: readonly PersonListing[] } | Refusal<"human_only">;
