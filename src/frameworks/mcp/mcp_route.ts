import { parseBotClients } from "../../interface_adapters/schemas/bot_clients_schema";
import type { Env } from "../env";
import { BotAuthenticator, bearerToken } from "./bot_auth";
import { serveMcp, type ToolHandlers } from "./mcp_server";

/** Builds the tool handlers for one request from the Worker's env (the composition root's job). */
export type ToolHandlerFactory = (env: Env) => ToolHandlers;

function jsonError(status: 401 | 503, error: string, headers: HeadersInit = {}): Response {
  return Response.json({ error }, { status, headers });
}

/**
 * Every value the deployment keeps secret, and the caller's own token: presenters redact them all
 * from every tool result (I6, R8).
 */
export function secretsOf(env: Env, token: string): readonly string[] {
  const keys = env.GROKCHAT_TOKEN_KEYS.split(",");
  return [
    token,
    env.X_CLIENT_SECRET,
    env.GROKCHAT_TOKEN_KEYS,
    env.GROKCHAT_SESSION_SECRET,
    env.GROKCHAT_ADMIN_PASSWORD_HASH,
    ...keys,
  ].flatMap((value) => (value === undefined || value.trim() === "" ? [] : [value.trim()]));
}

/**
 * `/mcp` and `/mcp/` (plan §3.5): bot auth from `GROKCHAT_BOT_CLIENTS`, then a stateless MCP
 * server. A missing or malformed secret fails closed (503, nobody gets in); a wrong or missing
 * token is 401 before any MCP processing. Neither response quotes the token or the secret.
 */
export function mcpRoute(handlers: ToolHandlerFactory) {
  return async (request: Request, env: Env): Promise<Response> => {
    const clients = parseBotClients(env.GROKCHAT_BOT_CLIENTS);
    if (!clients.ok) {
      console.error(`grokchat mcp: GROKCHAT_BOT_CLIENTS refused (${clients.problem})`);
      return jsonError(503, "bot_auth_unavailable");
    }
    const token = bearerToken(request.headers.get("authorization"));
    const actor =
      token === null ? null : await new BotAuthenticator(clients.clients).authenticate(token);
    if (token === null || actor === null) {
      return jsonError(401, "unauthorized", { "WWW-Authenticate": 'Bearer realm="grokchat"' });
    }
    return serveMcp(request, { actor, secrets: secretsOf(env, token) }, handlers(env));
  };
}
