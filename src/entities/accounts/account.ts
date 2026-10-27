import type { AccountId, PersonalityId, XUserId } from "../identity/ids";
import type { PostingPolicy } from "./posting_policy";

/**
 * ACTIVE publishes; PAUSED is the kill switch (and a new account's state); DISCONNECTED and
 * NEEDS_RECONNECT are cleared only by reconnecting (plan §3.1, A2).
 */
export type AccountStatus = "ACTIVE" | "PAUSED" | "DISCONNECTED" | "NEEDS_RECONNECT";

/** Both must be confirmed on the dashboard before the account may publish (plan §0). */
export interface Disclosure {
  readonly bioConfirmed: boolean;
  readonly automatedLabelConfirmed: boolean;
}

export interface Account {
  readonly id: AccountId;
  readonly xUserId: XUserId;
  readonly handle: string;
  readonly personalityId: PersonalityId;
  readonly status: AccountStatus;
  readonly disclosure: Disclosure;
  readonly policy: PostingPolicy;
  /** X bills owned reads at $0.001 only for the app owner's own account (plan §1.1). */
  readonly isAppOwner: boolean;
}

export function disclosureComplete(disclosure: Disclosure): boolean {
  return disclosure.bioConfirmed && disclosure.automatedLabelConfirmed;
}
