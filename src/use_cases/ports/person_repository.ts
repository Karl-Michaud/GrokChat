import type { PersonId } from "../../entities/identity/ids";
import type { Person } from "../../entities/people/person";

/** The people who run bots (GROKCHAT-16), one row each, with only their token's hash. */
export interface PersonRepository {
  /** Every person, by name (ignoring ASCII case). */
  list(): Promise<readonly Person[]>;
  get(id: PersonId): Promise<Person | null>;
  /** The person whose name matches, ignoring ASCII case (names are unique that way). */
  findByName(name: string): Promise<Person | null>;
  /** The person whose token has this SHA-256 (lower-case hex), read fresh on every call. */
  findByTokenHash(sha256: string): Promise<Person | null>;
  /** Insert or replace by id; the person's accounts are kept. */
  save(person: Person): Promise<void>;
  /** Removes the person, and with it every account's assignment to them, in one step. */
  delete(id: PersonId): Promise<void>;
}
