import { Hono } from "hono";
import type { HealthView } from "../../interface_adapters/health/health_view_model";
import type { Env } from "../env";
import type { WebBindings } from "../web/web_context";

/** What the HTTP routes need from the composition root, one function per route. */
export interface HttpHandlers {
  health(): HealthView;
  /** The dashboard and the OAuth connect routes (frameworks/web), mounted at the root. */
  readonly web?: Hono<WebBindings>;
}

export function buildHttpApp(handlers: HttpHandlers): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/health", (c) => {
    const view = handlers.health();
    return c.json(view.body, view.httpStatus);
  });
  if (handlers.web !== undefined) {
    app.route("/", handlers.web);
  }
  return app;
}
