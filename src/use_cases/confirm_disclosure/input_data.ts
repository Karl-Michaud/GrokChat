import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

export interface ConfirmDisclosureInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly bioConfirmed: boolean;
  readonly automatedLabelConfirmed: boolean;
}
