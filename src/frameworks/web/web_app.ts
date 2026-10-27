import { Hono } from "hono";
import { accountRoutes, personalityRoutes } from "./account_routes";
import type { WebControllers } from "./controllers";
import { checkUnsafe, configure, requestLog, requireSession, securityHeaders } from "./middleware";
import { oauthRoutes } from "./oauth_routes";
import { postRoutes } from "./post_routes";
import { reportRoutes } from "./report_routes";
import { sessionRoutes } from "./session_routes";
import { errorPage } from "./views/layout";
import type { WebApp } from "./web_context";

const SCOPES = ["/dashboard", "/dashboard/*", "/oauth/*"];

/**
 * The dashboard and the OAuth connect routes (plan §3.5): server-rendered HTML behind the admin
 * session. Every route logs, sets the security headers, needs the config, then (except the login
 * form and htmx) a session, and on a non-GET the exact Origin and the CSRF token.
 */
export function buildWebApp(controllers: WebControllers): WebApp {
  const app: WebApp = new Hono();
  for (const scope of SCOPES) {
    app.use(scope, requestLog, securityHeaders, configure, requireSession, checkUnsafe);
  }
  sessionRoutes(app, controllers);
  postRoutes(app, controllers);
  accountRoutes(app, controllers);
  personalityRoutes(app, controllers);
  oauthRoutes(app, controllers);
  reportRoutes(app, controllers);
  app.onError((error, c) => {
    console.error(JSON.stringify({ route: "web", error: error.name }));
    return c.html(errorPage("Something went wrong.", null), 500);
  });
  return app;
}
