import type { Personality } from "../../entities/content/personality";
import type { Refusal } from "../access/refusal";

export type ListPersonalitiesOutputData =
  { readonly ok: true; readonly personalities: readonly Personality[] } | Refusal<"human_only">;
