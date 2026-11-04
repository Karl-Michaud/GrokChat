import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { MAX_UPLOAD_BYTES } from "../../entities/content/staged_media";
import { MEDIA_PAGE } from "../../interface_adapters/dashboard/media_controller";
import { checkUnsafeRequest } from "../../interface_adapters/dashboard/request_guard";
import { webConfig } from "./config";
import { formBody } from "./form_body";
import { OAUTH_CALLBACK, OAUTH_FINISH } from "./oauth_routes";
import { readSession, SESSION_COOKIE } from "./session";
import { frameOf } from "./respond";
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
  // The dashboard's own stylesheet only: no inline style, attribute or element (GROKCHAT-15).
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "form-action 'self' https://x.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * The pages whose URL carries the OAuth code and state. They hold no forms, so they send no
 * referrer at all, not even to this origin.
 */
const NO_REFERRER_PATHS = [OAUTH_CALLBACK, OAUTH_FINISH];

/**
 * Every other page is `same-origin`, never `no-referrer`: under the Fetch spec a plain form POST
 * from a `no-referrer` document sends `Origin: null`, which the exact Origin check refuses. That
 * broke "Connect on X" (a non-htmx form) and every form without JS. `same-origin` still sends
 * nothing to x.com or any other origin.
 */
export const referrerPolicy = (path: string): string =>
  NO_REFERRER_PATHS.includes(path) ? "no-referrer" : "same-origin";

/** No framing, no cross-origin referrer, no caching of pages. */
export const securityHeaders: Middleware = async (c, next) => {
  c.header("Content-Security-Policy", CSP);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", referrerPolicy(c.req.path));
  c.header("Cache-Control", "no-store");
  await next();
};

/** 503 until the session secret, the password hash and the public origin are all set. */
export const configure: Middleware = async (c, next) => {
  const config = webConfig(c.env);
  if (config === null) {
    return c.html(errorPage("The dashboard is not configured.", frameOf(c)), 503);
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
      : c.html(loginPage("Log in first.", frameOf(c)), 403);
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
    return c.html(errorPage(message, frameOf(c)), 403);
  }
  await next();
  return undefined;
};

/** Forms are small: anything larger is refused before it is parsed (the login is public). */
export const MAX_FORM_BYTES = 64 * 1024;

/**
 * The Media upload (GROKCHAT-18) is the one larger body: the file, at most the GIF limit (the same
 * as `stage_media_from_url`), plus its form fields. Only that exact path, and only for a session's
 * POST: the session check runs after, so an anonymous upload is still refused, just not read.
 */
export const MAX_UPLOAD_FORM_BYTES = MAX_UPLOAD_BYTES + MAX_FORM_BYTES;

const limit = (maxSize: number, message: string): Middleware =>
  bodyLimit({
    maxSize,
    onError: (c) =>
      c.html(errorPage(message, { csrf: "", theme: "system", path: c.req.path }), 413),
  });

const formLimit = limit(MAX_FORM_BYTES, "Refused: the form is too large.");
const uploadLimit = limit(
  MAX_UPLOAD_FORM_BYTES,
  "Refused: the file is too large (photos up to 5 MB, GIFs up to 15 MB).",
);

export const limitBody: Middleware = (c, next) =>
  c.req.method === "POST" && c.req.path === MEDIA_PAGE ? uploadLimit(c, next) : formLimit(c, next);
