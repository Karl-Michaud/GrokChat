import type { Actor } from "../../entities/identity/actor";
import type { AccountId, PersonalityId } from "../../entities/identity/ids";

export interface ConnectAccountCompleteInputData {
  readonly actor: Actor;
  readonly sessionId: string;
  readonly state: string;
  readonly code: string;
  /** Reconnect this account; null connects a new one. */
  readonly reconnect: AccountId | null;
  /** A new account's personality (1:1 in v0). */
  readonly personalityId: PersonalityId | null;
}
