import { Hono } from "hono";
import { accountRoutes } from "./account_routes";
import type { WebControllers } from "./controllers";
import {
  checkUnsafe,
  configure,
  limitBody,
  requestLog,
  requireSession,
  securityHeaders,
} from "./middleware";
import { mediaRoutes } from "./media_routes";
import { oauthRoutes } from "./oauth_routes";
import { postRoutes } from "./post_routes";
import { reportRoutes } from "./report_routes";
import { sessionRoutes } from "./session_routes";
import { frameOf } from "./respond";
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
    app.use(scope, requestLog, securityHeaders, limitBody, configure, requireSession, checkUnsafe);
  }
  sessionRoutes(app, controllers);
  postRoutes(app, controllers);
  accountRoutes(app, controllers);
  mediaRoutes(app, controllers);
  oauthRoutes(app, controllers);
  reportRoutes(app, controllers);
  app.onError((error, c) => {
    console.error(JSON.stringify({ route: "web", error: error.name }));
    return c.html(errorPage("Something went wrong.", frameOf(c)), 500);
  });
  return app;
}
