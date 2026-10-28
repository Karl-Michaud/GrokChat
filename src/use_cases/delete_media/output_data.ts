import type { AccountId } from "../../entities/identity/ids";
import type { Refusal } from "../access/refusal";

export type DeleteMediaOutputData =
  | { readonly ok: true; readonly accountId: AccountId }
  | Refusal<"not_found" | "human_only" | "media_in_use">;
