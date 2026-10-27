import type { Actor } from "../../entities/identity/actor";
import type { PersonalityId } from "../../entities/identity/ids";

export interface SavePersonalityInputData {
  readonly actor: Actor;
  /** Null creates a new personality. */
  readonly id: PersonalityId | null;
  readonly name: string;
  readonly voiceGuide: string;
  readonly topics: readonly string[];
  readonly dos: readonly string[];
  readonly donts: readonly string[];
  readonly examples: readonly string[];
}
