import { deleteCookie, setCookie } from "hono/cookie";
import { HOME_PAGE } from "../../interface_adapters/dashboard/session_controller";
import type { WebControllers } from "./controllers";
import { formBody } from "./form_body";
import { issueSession, SESSION_COOKIE, SESSION_TTL } from "./session";
import { HTMX } from "./static_assets";
import { loginPage } from "./views/layout";
import type { WebApp } from "./web_context";

const COOKIE = { path: "/", secure: true, httpOnly: true, sameSite: "Strict" } as const;

/** Login, logout and the vendored htmx file. */
export function sessionRoutes(app: WebApp, controllers: WebControllers): void {
  app.get("/dashboard", (c) => c.redirect(HOME_PAGE, 303));
  app.get("/dashboard/login", (c) => c.html(loginPage(null)));
  app.post("/dashboard/login", async (c) => {
    const config = c.get("config");
    const body = await formBody(c);
    const outcome = await controllers.session(config.verifier).login({
      password: body.one("password"),
      clientKey: c.req.header("cf-connecting-ip") ?? "unknown",
    });
    if (outcome.kind !== "redirect") {
      return c.html(
        loginPage(outcome.kind === "refused" ? outcome.message : null),
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
  app.get(HTMX.path, (c) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(HTMX.source, 200, { "Content-Type": "text/javascript; charset=utf-8" });
  });
}
