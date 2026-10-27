import { Hono } from "hono";
import type { HealthView } from "../../interface_adapters/health/health_view_model";
import type { Env } from "../env";

/** What the HTTP routes need from the composition root, one function per route. */
export interface HttpHandlers {
  health(): HealthView;
  /** The MCP endpoint (plan §3.5): every method, at `/mcp` and `/mcp/`. */
  mcp(request: Request, env: Env): Promise<Response>;
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
  return app;
}
