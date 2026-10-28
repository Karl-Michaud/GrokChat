import { accountId, personId, type AccountId, type PersonId } from "../../entities/identity/ids";
import type { AccountOwnership } from "../../entities/people/person";
import type { AccountOwners } from "../../use_cases/ports/account_owners";

interface OwnerRow {
  readonly id: string;
  readonly person_id: string;
}

/** `accounts.person_id` (migration 0004): the only column of `accounts` this driver writes. */
export class D1AccountOwners implements AccountOwners {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<readonly AccountOwnership[]> {
    const result = await this.db
      .prepare("SELECT id, person_id FROM accounts WHERE person_id IS NOT NULL ORDER BY id")
      .all<OwnerRow>();
    return result.results.map((row) => ({
      accountId: accountId(row.id),
      personId: personId(row.person_id),
    }));
  }

  async accountsOf(person: PersonId): Promise<readonly AccountId[]> {
    const result = await this.db
      .prepare("SELECT id FROM accounts WHERE person_id = ?1 ORDER BY id")
      .bind(person)
      .all<{ readonly id: string }>();
    return result.results.map((row) => accountId(row.id));
  }

  async assign(account: AccountId, person: PersonId | null): Promise<void> {
    await this.db
      .prepare("UPDATE accounts SET person_id = ?2 WHERE id = ?1")
      .bind(account, person)
      .run();
  }
}
