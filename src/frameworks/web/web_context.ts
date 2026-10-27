import type { Context, Hono } from "hono";
import type { Env } from "../env";
import type { WebConfig } from "./config";
import type { Session } from "./session";

/** The dashboard's Hono context: the parsed config and, behind the session guard, the session. */
export interface WebBindings {
  Bindings: Env;
  Variables: { config: WebConfig; session: Session | null };
}

export type WebApp = Hono<WebBindings>;
export type WebContext = Context<WebBindings>;

/** The session; only called on routes behind `requireSession`, which guarantees it. */
export function sessionOf(c: WebContext): Session {
  const session = c.get("session");
  if (session === null) {
    throw new Error("a session route ran without the session guard");
  }
  return session;
}
