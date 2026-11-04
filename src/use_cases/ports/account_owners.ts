import type { AccountId, PersonId } from "../../entities/identity/ids";
import type { AccountOwnership } from "../../entities/people/person";

/** Which person each account belongs to (GROKCHAT-16): at most one person per account. */
export interface AccountOwners {
  /** Every assignment, by account id. */
  list(): Promise<readonly AccountOwnership[]>;
  /** The person's accounts, by id, read fresh on every call (bot auth's scope). */
  accountsOf(person: PersonId): Promise<readonly AccountId[]>;
  /** Assigns the account to the person, or unassigns it (null). An unknown account is a no-op. */
  assign(account: AccountId, person: PersonId | null): Promise<void>;
}
