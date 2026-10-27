import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

/** The kill switch: only ACTIVE and PAUSED are set by hand; reconnecting clears the others. */
export interface SetAccountStatusInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly status: "ACTIVE" | "PAUSED";
}
