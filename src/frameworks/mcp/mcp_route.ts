import type { Env } from "../env";
import { bearerToken, type BotAuthenticator } from "./bot_auth";
import { serveMcp, type ToolHandlers } from "./mcp_server";

/** What the MCP route is built from, per request, by the composition root. */
export interface McpRouteDeps {
  /** The tool handlers over the Worker's graph for this env. */
  tools(env: Env): ToolHandlers;
  /** Bot auth over this env's D1 people. */
  authenticator(env: Env): BotAuthenticator;
}

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

/** The person the token belongs to, or "unavailable" when D1 could not be read (fail closed). */
async function actorFor(deps: McpRouteDeps, env: Env, token: string) {
  try {
    return await deps.authenticator(env).authenticate(token);
  } catch {
    console.error("grokchat mcp: bot auth unavailable");
    return "unavailable" as const;
  }
}

/**
 * `/mcp` and `/mcp/` (plan §3.5, GROKCHAT-16): bot auth against the people in D1, then a
 * stateless MCP server. A wrong or missing token is 401 before any MCP processing; a D1 failure
 * during auth is 503 and lets nobody in. Neither response quotes the token.
 */
export function mcpRoute(deps: McpRouteDeps) {
  return async (request: Request, env: Env): Promise<Response> => {
    const token = bearerToken(request.headers.get("authorization"));
    const actor = token === null ? null : await actorFor(deps, env, token);
    if (actor === "unavailable") {
      return jsonError(503, "bot_auth_unavailable");
    }
    if (token === null || actor === null) {
      return jsonError(401, "unauthorized", { "WWW-Authenticate": 'Bearer realm="grokchat"' });
    }
    return serveMcp(request, { actor, secrets: secretsOf(env, token) }, deps.tools(env));
  };
}
