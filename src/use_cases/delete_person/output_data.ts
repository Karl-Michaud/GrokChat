import type { Person } from "../../entities/people/person";
import type { Refusal } from "../access/refusal";
export type DeletePersonOutputData =
  | { readonly ok: true; readonly person: Person }
  | Refusal<"human_only" | "not_found" | "name_mismatch">;
