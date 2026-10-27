import type { Personality } from "../../entities/content/personality";
import type { Refusal } from "../access/refusal";

export type SavePersonalityOutputData =
  | { readonly ok: true; readonly personality: Personality }
  | Refusal<"human_only" | "not_found" | "name_required">;
