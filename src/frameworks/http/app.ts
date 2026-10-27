import { Hono } from "hono";
import type { HealthView } from "../../interface_adapters/health/health_view_model";
import type { Env } from "../env";
import type { WebBindings } from "../web/web_context";

/** What the HTTP routes need from the composition root, one function per route. */
export interface HttpHandlers {
  health(): HealthView;
  /** The MCP endpoint (plan §3.5): every method, at `/mcp` and `/mcp/`. */
  mcp(request: Request, env: Env): Promise<Response>;
  /** The dashboard and the OAuth connect routes (frameworks/web), mounted at the root. */
  readonly web?: Hono<WebBindings>;
}

export function buildHttpApp(handlers: HttpHandlers): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/health", (c) => {
    const view = handlers.health();
    return c.json(view.body, view.httpStatus);
  });
  // Both paths are routes of their own: xAI follows no redirect (U9).
  for (const path of ["/mcp", "/mcp/"]) {
    app.all(path, (c) => handlers.mcp(c.req.raw, c.env));
  }
  if (handlers.web !== undefined) {
    app.route("/", handlers.web);
  }
  return app;
}
