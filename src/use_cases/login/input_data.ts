import type { Actor } from "../../entities/identity/actor";

export interface LoginInputData {
  /** The dashboard's admin, as the session will name them. */
  readonly actor: Actor;
  readonly password: string;
  /** Who is trying (the client IP): throttled on its own and under one global key (rev 4 M8). */
  readonly clientKey: string;
}
