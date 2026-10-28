import type { Actor } from "../../entities/identity/actor";

/** The caller's own accounts. */
export interface ListOwnAccountsInputData {
  readonly actor: Actor;
}
