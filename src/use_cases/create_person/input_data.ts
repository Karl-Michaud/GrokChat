import type { Actor } from "../../entities/identity/actor";

/** A new person, by name (GROKCHAT-16). */
export interface CreatePersonInputData {
  readonly actor: Actor;
  readonly name: string;
}
