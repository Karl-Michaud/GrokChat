import type { AccountId, PersonId } from "../../entities/identity/ids";
import { nameKey, type AccountOwnership, type Person } from "../../entities/people/person";
import type { AccountOwners } from "../../use_cases/ports/account_owners";
import type { BotTokenIssuer, IssuedToken } from "../../use_cases/ports/bot_token_issuer";
import type { PersonRepository } from "../../use_cases/ports/person_repository";
import { tokenSha256 } from "../crypto/bot_token_issuer";
import type { MemoryAccountRepository } from "./memory_repositories";

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Assignments beside the account rows, as `accounts.person_id` sits beside D1's columns. */
export class MemoryAccountOwners implements AccountOwners {
  readonly rows = new Map<AccountId, PersonId>();

  constructor(private readonly accounts: MemoryAccountRepository) {}

  list(): Promise<readonly AccountOwnership[]> {
    const rows = [...this.rows.entries()].sort(([a], [b]) => byId(a, b));
    return Promise.resolve(rows.map(([accountId, personId]) => ({ accountId, personId })));
  }

  accountsOf(person: PersonId): Promise<readonly AccountId[]> {
    const ids = [...this.rows.entries()].filter(([, owner]) => owner === person);
    return Promise.resolve(ids.map(([account]) => account).sort(byId));
  }

  assign(account: AccountId, person: PersonId | null): Promise<void> {
    if (!this.accounts.rows.has(account)) {
      return Promise.resolve();
    }
    if (person === null) {
      this.rows.delete(account);
    } else {
      this.rows.set(account, person);
    }
    return Promise.resolve();
  }

  /** What deleting a person does to the assignments. */
  unassignAll(person: PersonId): void {
    for (const [account, owner] of [...this.rows.entries()]) {
      if (owner === person) {
        this.rows.delete(account);
      }
    }
  }
}

export class MemoryPersonRepository implements PersonRepository {
  readonly rows = new Map<PersonId, Person>();

  constructor(private readonly owners: MemoryAccountOwners) {}

  list(): Promise<readonly Person[]> {
    const people = [...this.rows.values()].sort(
      (a, b) => byId(nameKey(a.name), nameKey(b.name)) || byId(a.id, b.id),
    );
    return Promise.resolve(people);
  }

  get(id: PersonId): Promise<Person | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  findByName(name: string): Promise<Person | null> {
    const key = nameKey(name);
    return Promise.resolve(
      [...this.rows.values()].find((person) => nameKey(person.name) === key) ?? null,
    );
  }

  findByTokenHash(sha256: string): Promise<Person | null> {
    return Promise.resolve(
      [...this.rows.values()].find((person) => person.token?.sha256 === sha256) ?? null,
    );
  }

  save(person: Person): Promise<void> {
    this.rows.set(person.id, person);
    return Promise.resolve();
  }

  delete(id: PersonId): Promise<void> {
    this.owners.unassignAll(id);
    this.rows.delete(id);
    return Promise.resolve();
  }
}

/** Deterministic tokens (`token-1-…`, padded to 43 characters) with their real SHA-256. */
export class SequentialTokenIssuer implements BotTokenIssuer {
  private count = 0;

  async issue(): Promise<IssuedToken> {
    this.count += 1;
    const token = `token-${String(this.count)}-`.padEnd(43, "x");
    return { token, sha256: await tokenSha256(token) };
  }
}
