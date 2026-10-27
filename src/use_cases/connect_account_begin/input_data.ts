import type { Actor } from "../../entities/identity/actor";

export interface ConnectAccountBeginInputData {
  readonly actor: Actor;
  /** The admin session the OAuth state is bound to (rev 4 M7). */
  readonly sessionId: string;
}
