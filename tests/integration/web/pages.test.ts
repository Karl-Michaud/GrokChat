/** Every dashboard page through the web app, over the in-memory world (GROKCHAT-15). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountId, postId, xUserId } from "../../../src/entities/identity/ids";
import { DAY, HOUR } from "../../../src/entities/time/instant";
import { APP_CSS, APP_JS, fingerprint, HTMX } from "../../../src/frameworks/web/static_assets";
import { buildWebApp } from "../../../src/frameworks/web/web_app";
import {
  ACCOUNT,
  aFollowerSnapshot,
  aPost,
  aSnapshot,
  part,
  sentState,
  T0,
} from "../../unit/support/builders";
import { Browser, controllersFor, dashboard, ORIGIN, PASSWORD } from "./browser";

async function loggedIn() {
  const setup = await dashboard();
  await setup.world.seedAccount();
  await setup.browser.login();
  return setup;
}

/** A small, realistic dashboard: two accounts, posts with metrics, followers, costs. */
async function populated() {
  const setup = await loggedIn();
  const { world } = setup;
  await world.seedAccount({ id: accountId("acc-2"), xUserId: xUserId("x-2"), handle: "second" });
  await world.writer.add(
    aPost({
      id: postId("p-live"),
      lifecycle: "DONE",
      publishAt: T0 - DAY,
      parts: [part("<b>hi</b> live", sentState("x-1", T0 - DAY))],
    }),
  );
  await world.writer.add(
    aPost({ id: postId("p-next"), publishAt: T0 + HOUR, parts: [part("coming up")] }),
  );
  await world.metrics.addSnapshots([
    aSnapshot("x-1", T0 - 20 * HOUR, 900),
    aSnapshot("x-1", T0 - HOUR, 4_321),
  ]);
  const snapshot = aFollowerSnapshot(T0 - HOUR, 2_048);
  await world.followers.claim(ACCOUNT, snapshot.day, T0 - HOUR);
  await world.followers.record(snapshot);
  await world.audit.append({
    at: T0 - DAY,
    actor: "bot:muse",
    action: "post.create",
    accountId: ACCOUNT,
    postId: postId("p-live"),
    detail: "",
  });
  return setup;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const PAGES: readonly (readonly [string, string, string])[] = [
  ["/dashboard/analytics", "Analytics", "4.3K"],
  ["/dashboard/analytics?range=24h&metric=likes", "Analytics", "Last 24 hours"],
  ["/dashboard/analytics?range=all&account=acc-1", "Analytics", "All time"],
  ["/dashboard/posts", "Posts", "&lt;b&gt;hi&lt;/b&gt; live"],
  [
    "/dashboard/posts?account=acc-1&status=PUBLISHED&from=2026-10-01&sort=impressions&dir=desc",
    "Posts",
    "4.3K",
  ],
  ["/dashboard/posts/p-live", "Post", "https://x.com/musechat_one/status/x-1"],
  ["/dashboard/accounts", "Accounts", "@second"],
  ["/dashboard/activity", "Activity", "Created a post"],
  ["/dashboard/activity?actor=bot&kind=posts&account=acc-1", "Activity", "muse"],
];

describe("the dashboard pages (GROKCHAT-15)", () => {
  it("every page renders in the shell: sidebar, the current item, CSRF, stylesheet, scripts", async () => {
    const { browser } = await populated();
    for (const [path, title, text] of PAGES) {
      const page = await browser.page(path);
      expect([path, page.status]).toStrictEqual([path, 200]);
      expect(page.html).toContain(`<h1>${title}</h1>`);
      expect(page.html).toContain(text);
      expect(page.html).toContain(`<link rel="stylesheet" href="${APP_CSS.path}" />`);
      expect(page.html).toContain(`src="${HTMX.path}"`);
      expect(page.html).toContain(`integrity="${HTMX.integrity}"`);
      expect(page.html).toContain(`<script src="${APP_JS.path}" defer></script>`);
      expect(page.html).toContain(`name="_csrf" value="${browser.csrf}"`);
      const section = path.split("?")[0]?.split("/")[2] ?? "";
      expect(page.html).toMatch(new RegExp(`<a href="/dashboard/${section}" aria-current="page"`));
      expect(page.html).toContain('action="/dashboard/theme"');
      expect(page.html).not.toContain("<b>hi</b>");
    }
  });

  it("no page carries an inline script, style element or style attribute (CSP: same-origin only)", async () => {
    const { browser } = await populated();
    for (const [path] of PAGES) {
      const { html } = await browser.page(path);
      expect([path, /<script(?![^>]*\bsrc=)[^>]*>/i.test(html)]).toStrictEqual([path, false]);
      expect([path, /<style\b/i.test(html)]).toStrictEqual([path, false]);
      expect([path, /\sstyle=/i.test(html)]).toStrictEqual([path, false]);
      expect([path, /\son[a-z]+=/i.test(html)]).toStrictEqual([path, false]);
    }
  });

  it("analytics: KPI tiles, server-rendered SVG charts with a table view, accounts, top posts, spend, R2", async () => {
    const { browser } = await populated();
    const { html } = await browser.page("/dashboard/analytics");
    expect(html).toContain('<span class="kpi-label">Impressions</span>');
    expect(html).toContain('class="chart-line"');
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).toContain("Show as a table");
    expect(html).toMatch(/class="chart-cols"\s+tabindex="0"/);
    expect(html).toContain("2,048");
    expect(html).toContain("Top posts");
    expect(html).toContain("X API spend");
    expect(html).toContain("Media storage (R2)");
    expect(html).toContain('href="/dashboard/analytics?range=24h&amp;metric=impressions"');
    expect(html).toMatch(/<option value="acc-1"\s*>\s*@musechat_one\s*<\/option>/);
  });

  it("posts: sortable columns, status chips, links to X, pages; a post's page with its history", async () => {
    const { browser } = await populated();
    const list = await browser.page("/dashboard/posts?sort=impressions&dir=desc");
    expect(list.html).toContain('aria-sort="descending"');
    expect(list.html).toContain('class="chip good">Published</span>');
    expect(list.html).toContain('class="chip info">Scheduled</span>');
    expect(list.html).toContain("2 posts · page 1 of 1");
    const post = await browser.page("/dashboard/posts/p-live");
    expect(post.html).toContain("Metrics on X");
    expect(post.html).toContain("Created a post");
    expect(post.html).toContain('action="/dashboard/posts/p-live/delete"');
  });

  it("accounts: a card each, the kill switch, the bot setup with the MCP URL", async () => {
    const { browser } = await populated();
    const { html } = await browser.page("/dashboard/accounts");
    expect(html).toMatch(/class="switch"\s+role="switch"\s+aria-checked="true"/);
    expect(html).toContain(`data-copy="${ORIGIN}/mcp"`);
    expect(html).toContain("npm run add-bot -- --id &lt;bot name&gt; --accounts acc-1,acc-2");
    expect(html).toContain('data-copy="acc-1"');
    expect(html).toContain("Connect X account");
    expect(html).toContain('hx-boost="false"');
  });

  it("empty states say what to do next", async () => {
    const { browser } = await dashboard();
    await browser.login();
    expect((await browser.page("/dashboard/accounts")).html).toContain("No accounts yet");
    expect((await browser.page("/dashboard/posts")).html).toContain("No posts yet");
    expect((await browser.page("/dashboard/posts?status=FAILED")).html).toContain(
      "No post matches these filters",
    );
    expect((await browser.page("/dashboard/analytics")).html).toContain("No account connected");
    expect((await browser.page("/dashboard/activity?kind=reads")).html).toContain(
      "Nothing here yet",
    );
  });

  it("refusals show with their status; the old pages are gone", async () => {
    const { browser } = await loggedIn();
    const missing = await browser.page("/dashboard/posts/nope");
    expect([missing.status, missing.html.includes("Not found.")]).toStrictEqual([404, true]);
    for (const path of [
      "/dashboard/posts?status=LOST",
      "/dashboard/posts?from=soon",
      "/dashboard/analytics?range=1y",
      "/dashboard/activity?actor=robot",
      "/dashboard/activity?page=0",
    ]) {
      expect([path, (await browser.page(path)).status]).toStrictEqual([path, 400]);
    }
    for (const path of [
      "backlog",
      "calendar",
      "metrics",
      "costs",
      "media",
      "audit",
      "personalities",
    ]) {
      expect([path, (await browser.get(`/dashboard/${path}`)).status]).toStrictEqual([path, 404]);
    }
  });

  it("the dashboard root goes to the analytics", async () => {
    const { browser } = await loggedIn();
    const response = await browser.get("/dashboard");
    expect([response.status, response.headers.get("location")]).toStrictEqual([
      303,
      "/dashboard/analytics",
    ]);
  });
});

describe("headers and static files", () => {
  it("sets the security headers, with same-origin styles, and never caches a page", async () => {
    const { browser } = await loggedIn();
    const response = await browser.get("/dashboard/analytics");
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self' https://x.com; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      // Not no-referrer: a form POST from a no-referrer page sends `Origin: null`, refused.
      "referrer-policy": "same-origin",
      "cache-control": "no-store",
    });
  });

  it.each([
    [HTMX.path, "text/javascript; charset=utf-8", HTMX.source],
    [APP_CSS.path, "text/css; charset=utf-8", APP_CSS.source],
    [APP_JS.path, "text/javascript; charset=utf-8", APP_JS.source],
  ])("serves %s with a long cache, without a session", async (path, type, source) => {
    const { browser } = await dashboard();
    const response = await browser.get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await response.text()).toBe(source);
  });

  it("the stylesheet and script paths carry their content's fingerprint", () => {
    expect(APP_CSS.path).toBe(`/dashboard/static/app.${fingerprint(APP_CSS.source)}.css`);
    expect(APP_JS.path).toBe(`/dashboard/static/app.${fingerprint(APP_JS.source)}.js`);
    expect(fingerprint("")).toBe("811c9dc5");
    expect(fingerprint("a")).toBe("e40c292c");
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
  });

  it("the stylesheet defines its colours as tokens, with a dark mode for the system and the toggle", () => {
    expect(APP_CSS.source).toContain(":root {");
    expect(APP_CSS.source).toContain(
      '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {',
    );
    expect(APP_CSS.source).toContain(':root[data-theme="dark"] {');
    expect(APP_CSS.source).not.toMatch(/https?:\/\//);
  });
});

describe("logs (m3, I6)", () => {
  it("never contain Authorization, Cookie, the password, or the callback's code and state", async () => {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }
    const { browser, world } = await dashboard();
    await browser.login();
    const session = browser.cookies.get("__Host-grokchat_session") ?? "";
    await browser.get("/dashboard/analytics", { authorization: "Bearer sekrit-bearer-token" });
    await browser.post("/oauth/x/start", {});
    const state = [...world.states.records.keys()][0] ?? "";
    await browser.get(`/oauth/x/callback?code=code-SEKRIT&state=${state}`);
    await browser.get(`/oauth/x/finish?code=code-SEKRIT&state=${state}`);
    const logs = lines.join("\n");
    expect(logs).toContain('"path":"/oauth/x/callback"');
    expect(logs).toContain('"path":"/oauth/x/finish"');
    for (const secret of [
      "sekrit-bearer-token",
      "code-SEKRIT",
      state,
      session,
      browser.csrf,
      PASSWORD,
    ]) {
      expect(secret.length).toBeGreaterThan(3);
      expect(logs).not.toContain(secret);
    }
    expect(logs.toLowerCase()).not.toContain("authorization");
    expect(logs.toLowerCase()).not.toContain("cookie");
  });

  it("an unexpected error answers 500 and logs only its name", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { world, env } = await dashboard();
    const controllers = controllersFor(world);
    const failing = buildWebApp({
      ...controllers,
      analytics: Object.assign(
        Object.create(controllers.analytics) as typeof controllers.analytics,
        {
          analytics: () => Promise.reject(new TypeError("token=sekrit leaked in a message")),
        },
      ),
    });
    const browser = new Browser((request, e) => failing.fetch(request, e), env);
    await browser.login();
    lines.length = 0;
    const response = await browser.get("/dashboard/analytics");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Something went wrong.");
    expect(lines).toStrictEqual(['{"route":"web","error":"TypeError"}']);
  });

  it("logs one line per request, without the query", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const { browser } = await dashboard();
    await browser.get("/dashboard/login?next=secret-query");
    expect(lines).toHaveLength(1);
    await browser.get("/dashboard");
    await browser.get("/oauth/x/callback");
    expect(lines.map((line) => (JSON.parse(line) as { path: string }).path)).toStrictEqual([
      "/dashboard/login",
      "/dashboard",
      "/oauth/x/callback",
    ]);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      route: "web",
      method: "GET",
      path: "/dashboard/login",
      status: 200,
    });
  });
});
