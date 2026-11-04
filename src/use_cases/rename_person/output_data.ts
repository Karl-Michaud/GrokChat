import type { Person } from "../../entities/people/person";
import type { Refusal } from "../access/refusal";
export type RenamePersonOutputData =
  | { readonly ok: true; readonly person: Person }
  | Refusal<"human_only" | "not_found" | "invalid_name" | "name_taken">;
