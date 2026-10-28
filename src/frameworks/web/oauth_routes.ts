import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { OAuthController } from "../../interface_adapters/dashboard/oauth_controller";
import { refused } from "../../interface_adapters/dashboard/outcome";
import { OAUTH_STATE_TTL } from "../../use_cases/connect_account_begin/interactor";
import type { WebControllers } from "./controllers";
import { formBody } from "./form_body";
import { NO_PAGE, respond } from "./respond";
import { bouncePage } from "./views/account_pages";
import { sessionOf, type WebApp, type WebContext } from "./web_context";

/** Where the owner's choice (reconnect which account, or a new one) waits for X. */
export const CONNECT_COOKIE = "__Host-grokchat_connect";
const COOKIE = { path: "/", secure: true, httpOnly: true, sameSite: "Strict" } as const;

/** X's redirect back carries no SameSite=Strict cookie, so this hop only bounces (see below). */
export const OAUTH_CALLBACK = "/oauth/x/callback";
export const OAUTH_FINISH = "/oauth/x/finish";

interface Intent {
  readonly state: string | null;
  readonly reconnect: string | null;
}

/** The intent cookie, once (it is cleared), and only when this session signed it. */
async function takeIntent(c: WebContext): Promise<Intent> {
  const value = getCookie(c, CONNECT_COOKIE);
  deleteCookie(c, CONNECT_COOKIE, COOKIE);
  const payload =
    value === undefined ? null : await c.get("config").signer.verify("connect", value, Date.now());
  const text = (key: string) => (typeof payload?.[key] === "string" ? payload[key] : null);
  return text("session") === sessionOf(c).id
    ? { state: text("state"), reconnect: text("reconnect") }
    : { state: null, reconnect: null };
}

async function start(c: WebContext, oauth: OAuthController): Promise<Response> {
  const body = await formBody(c);
  const session = sessionOf(c);
  const outcome = await oauth.begin(session.id);
  if (outcome.kind !== "redirect") {
    return respond(c, outcome, NO_PAGE);
  }
  const intent = {
    session: session.id,
    state: new URL(outcome.location).searchParams.get("state"),
    reconnect: body.one("reconnect"),
  };
  const expiresAt = Date.now() + OAUTH_STATE_TTL;
  const value = await c.get("config").signer.sign("connect", expiresAt, intent);
  setCookie(c, CONNECT_COOKIE, value, { ...COOKIE, maxAge: OAUTH_STATE_TTL / 1000 });
  return c.redirect(outcome.location, 303);
}

async function finish(c: WebContext, oauth: OAuthController): Promise<Response> {
  const intent = await takeIntent(c);
  const state = c.req.query("state") ?? null;
  const error = c.req.query("error") ?? null;
  if (error === null && (intent.state === null || intent.state !== state)) {
    return respond(c, refused("oauth_state"), NO_PAGE);
  }
  const code = c.req.query("code") ?? null;
  const outcome = await oauth.complete({ sessionId: sessionOf(c).id, code, state, error, intent });
  return respond(c, outcome, NO_PAGE);
}

/**
 * The OAuth connect flow behind the admin session (plan §3.5, R11). The start is a POST (session,
 * CSRF and Origin checked) and leaves a ten-minute intent cookie bound to the session and the
 * state. X sends the browser back with a cross-site navigation, which carries no Strict cookie, so
 * the callback answers a page that navigates on to the finish route from our own origin; there the
 * session and the intent cookie are both present and checked before the use case runs.
 */
export function oauthRoutes(app: WebApp, { oauth }: WebControllers): void {
  app.post("/oauth/x/start", (c) => start(c, oauth));
  app.get(OAUTH_CALLBACK, (c) => c.html(bouncePage(`${OAUTH_FINISH}${new URL(c.req.url).search}`)));
  app.get(OAUTH_FINISH, (c) => finish(c, oauth));
}
