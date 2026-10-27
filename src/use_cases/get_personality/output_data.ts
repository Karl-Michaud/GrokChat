import type { Personality } from "../../entities/content/personality";
import type { Refusal } from "../access/refusal";

export type GetPersonalityOutputData =
  | { readonly ok: true; readonly personality: Personality }
  | Refusal<"not_found" | "scope" | "personality_not_found">;
