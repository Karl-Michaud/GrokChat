import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

export interface ConnectAccountCompleteInputData {
  readonly actor: Actor;
  readonly sessionId: string;
  readonly state: string;
  readonly code: string;
  /** Reconnect this account; null connects a new one. */
  readonly reconnect: AccountId | null;
}
