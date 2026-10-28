import { personId, type PersonId } from "../../entities/identity/ids";
import type { Person, PersonToken } from "../../entities/people/person";
import type { Instant } from "../../entities/time/instant";
import type { PersonRepository } from "../../use_cases/ports/person_repository";

interface PersonRow {
  readonly id: string;
  readonly name: string;
  readonly token_sha256: string | null;
  readonly token_created_at: number | null;
  readonly created_at: number;
}

const COLUMNS = "id, name, token_sha256, token_created_at, created_at";

function fromRow(row: PersonRow): Person {
  return {
    id: personId(row.id),
    name: row.name,
    createdAt: row.created_at,
    token:
      row.token_sha256 === null || row.token_created_at === null
        ? null
        : { sha256: row.token_sha256, createdAt: row.token_created_at },
  };
}

/** `people` (migration 0004). The name column is NOCASE, so lookups and the order ignore case. */
export class D1PersonRepository implements PersonRepository {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<readonly Person[]> {
    const result = await this.db
      .prepare(`SELECT ${COLUMNS} FROM people ORDER BY name, id`)
      .all<PersonRow>();
    return result.results.map(fromRow);
  }

  get(id: PersonId): Promise<Person | null> {
    return this.one("id = ?1", id);
  }

  findByName(name: string): Promise<Person | null> {
    return this.one("name = ?1", name);
  }

  findByTokenHash(sha256: string): Promise<Person | null> {
    return this.one("token_sha256 = ?1", sha256);
  }

  async save(person: Person): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO people (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (id) DO UPDATE ` +
          "SET name = excluded.name, token_sha256 = excluded.token_sha256, " +
          "token_created_at = excluded.token_created_at, created_at = excluded.created_at",
      )
      .bind(
        person.id,
        person.name,
        person.token?.sha256 ?? null,
        person.token?.createdAt ?? null,
        person.createdAt,
      )
      .run();
  }

  /** `IS ?2` matches NULL to NULL, so "no token yet" is a comparison like any other. */
  async replaceToken(id: PersonId, expected: Instant | null, token: PersonToken): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE people SET token_sha256 = ?3, token_created_at = ?4 " +
          "WHERE id = ?1 AND token_created_at IS ?2",
      )
      .bind(id, expected, token.sha256, token.createdAt)
      .run();
    return result.meta.changes === 1;
  }

  /** One batch, so an account is never left assigned to a person who is gone. */
  async delete(id: PersonId): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE accounts SET person_id = NULL WHERE person_id = ?1").bind(id),
      this.db.prepare("DELETE FROM people WHERE id = ?1").bind(id),
    ]);
  }

  private async one(where: string, value: string): Promise<Person | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM people WHERE ${where}`)
      .bind(value)
      .first<PersonRow>();
    return row === null ? null : fromRow(row);
  }
}
