import type { Person } from "../../entities/people/person";
import type { Refusal } from "../access/refusal";
export type CreatePersonOutputData =
  | { readonly ok: true; readonly person: Person }
  | Refusal<"human_only" | "invalid_name" | "name_taken">;
