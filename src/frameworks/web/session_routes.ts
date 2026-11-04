import { deleteCookie, setCookie } from "hono/cookie";
import { HOME_PAGE } from "../../interface_adapters/dashboard/session_controller";
import type { WebControllers } from "./controllers";
import { formBody } from "./form_body";
import { frameOf } from "./respond";
import { issueSession, SESSION_COOKIE, SESSION_TTL } from "./session";
import { APP_CSS, APP_JS, HTMX, type StaticAsset } from "./static_assets";
import { currentTheme, nextTheme, THEME_COOKIE } from "./theme";
import { loginPage } from "./views/layout";
import type { WebApp } from "./web_context";

const COOKIE = { path: "/", secure: true, httpOnly: true, sameSite: "Strict" } as const;

/** A year: the theme is a preference, not a secret. */
const THEME_TTL = 365 * 24 * 60 * 60;

/** Only back to a dashboard page of this origin, never an arbitrary URL (no open redirect). */
export function backTo(value: string | null): string {
  return value !== null && /^\/dashboard(\/[\w./-]*)?$/.test(value) ? value : HOME_PAGE;
}

function staticFile(app: WebApp, asset: StaticAsset): void {
  app.get(asset.path, (c) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(asset.source, 200, { "Content-Type": asset.contentType });
  });
}

/** Login, logout, the theme toggle, and the dashboard's own static files. */
export function sessionRoutes(app: WebApp, controllers: WebControllers): void {
  app.get("/dashboard", (c) => c.redirect(HOME_PAGE, 303));
  app.get("/dashboard/login", (c) => c.html(loginPage(null, frameOf(c))));
  app.post("/dashboard/login", async (c) => {
    const config = c.get("config");
    const body = await formBody(c);
    const outcome = await controllers.session(config.verifier).login({
      password: body.one("password"),
      clientKey: c.req.header("cf-connecting-ip") ?? "unknown",
    });
    if (outcome.kind !== "redirect") {
      return c.html(
        loginPage(outcome.kind === "refused" ? outcome.message : null, frameOf(c)),
        outcome.kind === "refused" ? outcome.status : 400,
      );
    }
    const { cookie } = await issueSession(config.signer, Date.now());
    setCookie(c, SESSION_COOKIE, cookie, { ...COOKIE, maxAge: SESSION_TTL / 1000 });
    return c.redirect(outcome.location, 303);
  });
  app.post("/dashboard/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, COOKIE);
    return c.redirect("/dashboard/login", 303);
  });
  app.post("/dashboard/theme", async (c) => {
    const back = backTo((await formBody(c)).one("back") || null);
    setCookie(c, THEME_COOKIE, nextTheme(currentTheme(c)), { ...COOKIE, maxAge: THEME_TTL });
    return c.redirect(back, 303);
  });
  staticFile(app, {
    path: HTMX.path,
    contentType: "text/javascript; charset=utf-8",
    source: HTMX.source,
  });
  staticFile(app, APP_CSS);
  staticFile(app, APP_JS);
}
