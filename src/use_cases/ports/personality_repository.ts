import type { Personality } from "../../entities/content/personality";
import type { PersonalityId } from "../../entities/identity/ids";

export interface PersonalityRepository {
  get(id: PersonalityId): Promise<Personality | null>;
  list(): Promise<readonly Personality[]>;
  save(personality: Personality): Promise<void>;
}
