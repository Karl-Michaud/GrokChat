import type { Personality } from "../../entities/content/personality";
import { personalityId, type PersonalityId } from "../../entities/identity/ids";
import type { PersonalityRepository } from "../../use_cases/ports/personality_repository";

interface PersonalityRow {
  readonly id: string;
  readonly name: string;
  readonly voice_guide: string;
  readonly topics: string;
  readonly dos: string;
  readonly donts: string;
  readonly examples: string;
  readonly version: number;
}

const COLUMNS = "id, name, voice_guide, topics, dos, donts, examples, version";

const strings = (json: string): readonly string[] => JSON.parse(json) as readonly string[];

function fromRow(row: PersonalityRow): Personality {
  return {
    id: personalityId(row.id),
    name: row.name,
    voiceGuide: row.voice_guide,
    topics: strings(row.topics),
    dos: strings(row.dos),
    donts: strings(row.donts),
    examples: strings(row.examples),
    version: row.version,
  };
}

export class D1PersonalityRepository implements PersonalityRepository {
  constructor(private readonly db: D1Database) {}

  async get(id: PersonalityId): Promise<Personality | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM personalities WHERE id = ?1`)
      .bind(id)
      .first<PersonalityRow>();
    return row === null ? null : fromRow(row);
  }

  async list(): Promise<readonly Personality[]> {
    const result = await this.db
      .prepare(`SELECT ${COLUMNS} FROM personalities ORDER BY id`)
      .all<PersonalityRow>();
    return result.results.map(fromRow);
  }

  async save(personality: Personality): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO personalities (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        personality.id,
        personality.name,
        personality.voiceGuide,
        JSON.stringify(personality.topics),
        JSON.stringify(personality.dos),
        JSON.stringify(personality.donts),
        JSON.stringify(personality.examples),
        personality.version,
      )
      .run();
  }
}
