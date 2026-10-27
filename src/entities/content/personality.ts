import type { PersonalityId } from "../identity/ids";

/** The voice a bot writes in. GrokChat stores and serves it; it generates no content. */
export interface Personality {
  readonly id: PersonalityId;
  readonly name: string;
  readonly voiceGuide: string;
  readonly topics: readonly string[];
  readonly dos: readonly string[];
  readonly donts: readonly string[];
  readonly examples: readonly string[];
  readonly version: number;
}
