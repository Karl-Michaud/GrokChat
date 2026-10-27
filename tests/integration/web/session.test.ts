import { describe, expect, it } from "vitest";
import { CONNECT_COOKIE } from "../../../src/frameworks/web/oauth_routes";
import { SESSION_COOKIE } from "../../../src/frameworks/web/session";
import { dashboard, ORIGIN } from "./browser";

describe("login (plan §3.5, R12)", () => {
  it("the right password sets a 12-hour Strict, Secure, HttpOnly session cookie", async () => {
    const { browser, world } = await dashboard();
    const response = await browser.post("/dashboard/login", {
      password: "correct horse battery staple",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dashboard/backlog");
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith(SESSION_COOKIE));
    expect(cookie).toMatch(/; Max-Age=43200; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
    expect(world.audit.events.map((event) => event.action)).toStrictEqual(["session.login"]);
    const page = await browser.page("/dashboard/backlog");
    expect(page.status).toBe(200);
    expect(page.html).toContain("<h1>Backlog</h1>");
  });

  it("a wrong password is 401 and sets no cookie; five failures throttle to 429", async () => {
    const { browser } = await dashboard();
    const wrong = await browser.post("/dashboard/login", { password: "nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.getSetCookie()).toStrictEqual([]);
    expect(await wrong.text()).toContain("Wrong password.");
    for (let i = 0; i < 4; i += 1) {
      await browser.post("/dashboard/login", { password: "nope" });
    }
    const throttled = await browser.login();
    expect(throttled.status).toBe(429);
    expect(await throttled.text()).toContain("Too many failed logins");
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("throttles by the client IP Cloudflare reports", async () => {
    const { app, env } = await dashboard();
    const attempt = (ip: string, password: string) =>
      app.fetch(
        new Request(`${ORIGIN}/dashboard/login`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "cf-connecting-ip": ip,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ password }),
        }),
        env,
      );
    for (let i = 0; i < 4; i += 1) {
      expect((await attempt("1.1.1.1", "x")).status).toBe(401);
    }
    expect((await attempt("2.2.2.2", "x")).status).toBe(401);
    expect((await attempt("3.3.3.3", "correct horse battery staple")).status).toBe(429);
  });

  it("the login form needs the exact Origin (R12)", async () => {
    const { browser } = await dashboard();
    for (const origin of [null, "https://evil.example", `${ORIGIN}/`]) {
      const response = await browser.post(
        "/dashboard/login",
        { password: "correct horse battery staple" },
        { origin },
      );
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toStrictEqual([]);
    }
  });

  it("shows the login form, sends pages to it without a session, and logs out", async () => {
    const { browser } = await dashboard();
    const form = await browser.page("/dashboard/login");
    expect(form.status).toBe(200);
    expect(form.html).toContain('name="password"');
    expect(form.html).not.toContain("<nav>");
    const away = await browser.get("/dashboard/accounts");
    expect([away.status, away.headers.get("location")]).toStrictEqual([303, "/dashboard/login"]);
    await browser.login();
    const home = await browser.get("/dashboard");
    expect([home.status, home.headers.get("location")]).toStrictEqual([303, "/dashboard/backlog"]);
    expect((await browser.get("/dashboard/accounts")).status).toBe(200);
    const out = await browser.post("/dashboard/logout");
    expect([out.status, out.headers.get("location")]).toStrictEqual([303, "/dashboard/login"]);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
    expect((await browser.get("/dashboard/accounts")).status).toBe(303);
  });

  it("refuses a forged or foreign session cookie", async () => {
    const { browser } = await dashboard();
    browser.cookies.set(SESSION_COOKIE, "eyJpZCI6ImEifQ.AAAA");
    expect((await browser.get("/dashboard/backlog")).status).toBe(303);
    const other = await dashboard({ GROKCHAT_SESSION_SECRET: "another-secret-another-secret-123" });
    await other.browser.login();
    browser.cookies.set(SESSION_COOKIE, other.browser.cookies.get(SESSION_COOKIE) ?? "");
    expect((await browser.get("/dashboard/backlog")).status).toBe(303);
  });

  it("refuses a form over 64 KiB before parsing it", async () => {
    const { browser } = await dashboard();
    const response = await browser.post("/dashboard/login", { password: "x".repeat(70_000) });
    expect(response.status).toBe(413);
    expect(await response.text()).toContain("the form is too large");
  });

  it("answers 503 until the dashboard is configured", async () => {
    const { browser } = await dashboard({ GROKCHAT_PUBLIC_ORIGIN: "" });
    const response = await browser.get("/dashboard/login");
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("The dashboard is not configured.");
    expect((await browser.get("/oauth/x/callback?code=c&state=s")).status).toBe(503);
  });
});

describe("CSRF and Origin on every non-GET route (m4, R12)", () => {
  const routes = [
    "/dashboard/logout",
    "/dashboard/posts/post-1/approve",
    "/dashboard/posts/post-1/edit",
    "/dashboard/accounts/acc-1/status?to=PAUSED",
    "/dashboard/accounts/acc-1/disclosure",
    "/dashboard/accounts/acc-1/policy",
    "/dashboard/personalities",
    "/oauth/x/start",
  ];

  it("refuses a POST without the token, with a wrong one, or from another origin", async () => {
    const { browser, world } = await dashboard();
    await world.seedAccount({ status: "ACTIVE" });
    await browser.login();
    for (const route of routes) {
      const cases = [
        { csrf: null },
        { csrf: "wrong" },
        { origin: "https://evil.workers.dev" },
        { origin: null },
      ];
      for (const options of cases) {
        const response = await browser.post(route, {}, options);
        expect([route, response.status]).toStrictEqual([route, 403]);
      }
    }
    expect((await world.accounts.list())[0]?.status).toBe("ACTIVE");
    expect(world.states.records.size).toBe(0);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(true);
    expect(browser.cookies.has(CONNECT_COOKIE)).toBe(false);
  });

  it("accepts the token as a header too", async () => {
    const { browser, world } = await dashboard();
    await world.seedAccount({ status: "ACTIVE" });
    await browser.login();
    const response = await browser.post(
      "/dashboard/accounts/acc-1/status?to=PAUSED",
      {},
      { csrf: "" },
    );
    expect(response.status).toBe(403);
    const request = new Request(`${ORIGIN}/dashboard/accounts/acc-1/status?to=PAUSED`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "x-csrf-token": browser.csrf,
        cookie: `${SESSION_COOKIE}=${browser.cookies.get(SESSION_COOKIE) ?? ""}`,
      },
    });
    const direct = await browser.raw(request);
    expect(direct.status).toBe(303);
    expect((await world.accounts.list())[0]?.status).toBe("PAUSED");
  });

  it("a POST without a session is refused before anything runs", async () => {
    const { browser, world } = await dashboard();
    await world.seedAccount({ status: "ACTIVE" });
    for (const route of routes) {
      const response = await browser.post(route, {}, { csrf: null });
      expect(response.status).toBe(403);
    }
    expect((await world.accounts.list())[0]?.status).toBe("ACTIVE");
  });
});
