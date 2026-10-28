import type { Refusal } from "../access/refusal";
export type AssignAccountOutputData =
  { readonly ok: true } | Refusal<"human_only" | "not_found" | "person_not_found">;
