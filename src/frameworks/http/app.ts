import { Hono } from "hono";
import type { HealthView } from "../../interface_adapters/health/health_view_model";
import type { Env } from "../env";

/** What the HTTP routes need from the composition root, one function per route. */
export interface HttpHandlers {
  health(): HealthView;
}

export function buildHttpApp(handlers: HttpHandlers): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/health", (c) => {
    const view = handlers.health();
    return c.json(view.body, view.httpStatus);
  });
  return app;
}
