import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { checkUnsafeRequest } from "../../interface_adapters/dashboard/request_guard";
import { webConfig } from "./config";
import { formBody } from "./form_body";
import { readSession, SESSION_COOKIE } from "./session";
import { errorPage, loginPage } from "./views/layout";
import type { WebBindings } from "./web_context";

type Middleware = MiddlewareHandler<WebBindings>;

/**
 * One line per request: method, path (never the query, which carries the OAuth code and state on
 * the callback), status and wall time. Never a header, so never Authorization or Cookie (m3).
 */
export const requestLog: Middleware = async (c, next) => {
  const started = Date.now();
  await next();
  console.log(
    JSON.stringify({
      route: "web",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    }),
  );
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "form-action 'self' https://x.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

/** No framing, no referrer (the callback URL carries the code), no caching of pages. */
export const securityHeaders: Middleware = async (c, next) => {
  c.header("Content-Security-Policy", CSP);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  await next();
};

/** 503 until the session secret, the password hash and the public origin are all set. */
export const configure: Middleware = async (c, next) => {
  const config = webConfig(c.env);
  if (config === null) {
    return c.html(errorPage("The dashboard is not configured.", null), 503);
  }
  c.set("config", config);
  c.set("session", null);
  await next();
  return undefined;
};

/** No session needed: the login form, and X's redirect back, which only bounces on. */
const OPEN_PATHS = ["/dashboard/login", "/oauth/x/callback"];

/** A valid signed session cookie, or: a page asks to log in, anything else is refused. */
export const requireSession: Middleware = async (c, next) => {
  if (OPEN_PATHS.includes(c.req.path) || c.req.path.startsWith("/dashboard/static/")) {
    await next();
    return undefined;
  }
  const session = await readSession(
    c.get("config").signer,
    getCookie(c, SESSION_COOKIE),
    Date.now(),
  );
  if (session === null) {
    return c.req.method === "GET"
      ? c.redirect("/dashboard/login", 303)
      : c.html(loginPage("Log in first."), 403);
  }
  c.set("session", session);
  await next();
  return undefined;
};

/** Every non-GET route: the exact Origin, and the session's CSRF token when there is a session. */
export const checkUnsafe: Middleware = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    await next();
    return undefined;
  }
  const session = c.get("session");
  const sent =
    session === null
      ? null
      : (await formBody(c)).one("_csrf") || (c.req.header("x-csrf-token") ?? null);
  const verdict = checkUnsafeRequest({
    origin: c.req.header("origin") ?? null,
    expectedOrigin: c.get("config").origin,
    sentToken: sent,
    sessionToken: session?.csrf ?? null,
  });
  if (verdict !== "ok") {
    const message =
      verdict === "origin" ? "Refused: wrong origin." : "Refused: missing or wrong CSRF token.";
    return c.html(errorPage(message, null), 403);
  }
  await next();
  return undefined;
};

/** Forms are small: anything larger is refused before it is parsed (the login is public). */
export const MAX_FORM_BYTES = 64 * 1024;

export const limitBody: Middleware = bodyLimit({
  maxSize: MAX_FORM_BYTES,
  onError: (c) => c.html(errorPage("Refused: the form is too large.", null), 413),
});
