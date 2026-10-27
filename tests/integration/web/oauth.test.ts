import { describe, expect, it } from "vitest";
import { accountId, xUserId } from "../../../src/entities/identity/ids";
import { MINUTE } from "../../../src/entities/time/instant";
import { CONNECT_COOKIE } from "../../../src/frameworks/web/oauth_routes";
import { SESSION_COOKIE } from "../../../src/frameworks/web/session";
import { aPersonality } from "../../unit/support/builders";
import type { World } from "../../unit/support/world";
import { Browser, dashboard } from "./browser";

const user = (id = "x-user-9", handle = "newbie") => ({
  xUserId: xUserId(id),
  handle,
  tokens: { accessToken: "at", refreshToken: "rt", accessExpiresAt: 0 },
});

async function connected() {
  const setup = await dashboard();
  await setup.world.personalities.save(aPersonality());
  await setup.browser.login();
  return setup;
}

/** Starts a connect, and has X issue `code-1` for the PKCE verifier it was sent. */
async function start(browser: Browser, world: World, form: Record<string, string>, who = user()) {
  const response = await browser.post("/oauth/x/start", form);
  const location = response.headers.get("location") ?? "";
  const state = new URL(location).searchParams.get("state") ?? "";
  const verifier = world.states.records.get(state)?.verifier ?? "";
  world.connector.codes.set("code-1", { verifier, user: who });
  return { response, location, state };
}

const finish = (browser: Browser, state: string, code = "code-1") =>
  browser.get(`/oauth/x/finish?code=${code}&state=${state}`);

describe("the OAuth connect flow (plan §3.5, R11)", () => {
  it("start → X → callback bounce → finish connects a new, paused account", async () => {
    const { browser, world } = await connected();
    const started = await start(browser, world, { personality: "pers-1" });
    expect(started.response.status).toBe(303);
    expect(started.location).toBe(
      "https://x.com/i/oauth2/authorize?state=id-1&code_challenge=challenge-1",
    );
    const cookie = started.response.headers
      .getSetCookie()
      .find((line) => line.startsWith(CONNECT_COOKIE));
    expect(cookie).toMatch(/; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
    const anonymous = new Browser((request) => browser.raw(request), undefined as never);
    const bounce = await anonymous.get(`/oauth/x/callback?code=code-1&state=${started.state}`);
    expect(bounce.status).toBe(200);
    const html = await bounce.text();
    expect(html).toContain(
      `<meta http-equiv="refresh" content="0; url=/oauth/x/finish?code=code-1&amp;state=${started.state}" />`,
    );
    expect(world.states.records.size).toBe(1);
    const done = await finish(browser, started.state);
    expect([done.status, done.headers.get("location")]).toStrictEqual([
      303,
      "/dashboard/accounts?connected=%40newbie",
    ]);
    expect((await world.accounts.findByXUserId(xUserId("x-user-9")))?.status).toBe("PAUSED");
    expect(browser.cookies.has(CONNECT_COOKIE)).toBe(false);
    const page = await browser.page("/dashboard/accounts?connected=%40newbie");
    expect(page.html).toContain("Connected @newbie. It starts paused.");
  });

  it("refuses a replayed state, with or without the intent cookie", async () => {
    const { browser, world } = await connected();
    const started = await start(browser, world, { personality: "pers-1" });
    const intent = browser.cookies.get(CONNECT_COOKIE) ?? "";
    expect((await finish(browser, started.state)).status).toBe(303);
    const replay = await finish(browser, started.state);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain(
      "expired, was already used, or belongs to another session",
    );
    browser.cookies.set(CONNECT_COOKIE, intent);
    world.connector.codes.set("code-1", { verifier: "verifier-1", user: user() });
    expect((await finish(browser, started.state)).status).toBe(400);
    expect(await world.accounts.list()).toHaveLength(1);
  });

  it("refuses the finish without the admin session, writing nothing", async () => {
    const { browser, world, env, app } = await connected();
    const started = await start(browser, world, { personality: "pers-1" });
    const stranger = new Browser((request, e) => app.fetch(request, e), env);
    stranger.cookies.set(CONNECT_COOKIE, browser.cookies.get(CONNECT_COOKIE) ?? "");
    const response = await finish(stranger, started.state);
    expect([response.status, response.headers.get("location")]).toStrictEqual([
      303,
      "/dashboard/login",
    ]);
    expect(world.states.records.has(started.state)).toBe(true);
    expect(await world.accounts.list()).toStrictEqual([]);
  });

  it("refuses another session's state or intent cookie (foreign state)", async () => {
    const { browser, world, env, app } = await connected();
    const started = await start(browser, world, { personality: "pers-1" });
    const other = new Browser((request, e) => app.fetch(request, e), env);
    await other.login();
    expect(other.cookies.get(SESSION_COOKIE)).not.toBe(browser.cookies.get(SESSION_COOKIE));
    other.cookies.set(CONNECT_COOKIE, browser.cookies.get(CONNECT_COOKIE) ?? "");
    expect((await finish(other, started.state)).status).toBe(400);
    const own = await start(other, world, { personality: "pers-1" });
    expect(own.state).not.toBe(started.state);
    expect((await finish(other, started.state)).status).toBe(400);
    expect(await world.accounts.list()).toStrictEqual([]);
    const verifier = world.states.records.get(started.state)?.verifier ?? "";
    world.connector.codes.set("code-1", { verifier, user: user() });
    expect((await finish(browser, started.state)).status).toBe(303);
  });

  it("refuses an expired state", async () => {
    const { browser, world } = await connected();
    const started = await start(browser, world, { personality: "pers-1" });
    world.clock.advance(11 * MINUTE);
    expect((await finish(browser, started.state)).status).toBe(400);
    expect(await world.accounts.list()).toStrictEqual([]);
  });

  it("a reconnect must come back as the same X user (account swap)", async () => {
    const { browser, world } = await connected();
    await world.seedAccount({ status: "NEEDS_RECONNECT" });
    const swapped = await start(browser, world, { reconnect: "acc-1" }, user("x-user-9"));
    const refused = await finish(browser, swapped.state);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("different account");
    expect((await world.accounts.get(accountId("acc-1")))?.status).toBe("NEEDS_RECONNECT");
    const same = await start(browser, world, { reconnect: "acc-1" }, user("x-user-1", "renamed"));
    expect((await finish(browser, same.state)).status).toBe(303);
    expect(await world.accounts.get(accountId("acc-1"))).toMatchObject({
      status: "PAUSED",
      handle: "renamed",
    });
  });

  it("shows X's refusal without echoing it, and a missing code", async () => {
    const { browser, world } = await connected();
    const started = await start(browser, world, { personality: "pers-1" });
    const denied = await browser.get(`/oauth/x/finish?error=access_denied&state=${started.state}`);
    expect(denied.status).toBe(400);
    const text = await denied.text();
    expect(text).toContain("cancelled or refused on X");
    expect(text).not.toContain("access_denied");
    const again = await start(browser, world, { personality: "pers-1" });
    expect((await browser.get(`/oauth/x/finish?state=${again.state}`)).status).toBe(400);
  });
});
