import { afterEach, describe, expect, it, vi } from "vitest";
import { postId, xPostId } from "../../../src/entities/identity/ids";
import { HOUR } from "../../../src/entities/time/instant";
import { buildWebApp } from "../../../src/frameworks/web/web_app";
import { HTMX } from "../../../src/frameworks/web/static_assets";
import { ACCOUNT, aPersonality, aPost, part, sentState, T0 } from "../../unit/support/builders";
import { Browser, controllersFor, dashboard, ORIGIN, PASSWORD } from "./browser";

async function loggedIn() {
  const setup = await dashboard();
  await setup.world.seedAccount();
  await setup.browser.login();
  return setup;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the dashboard pages (plan §3.4)", () => {
  it("every page renders behind the session with the nav, the CSRF token and htmx", async () => {
    const { browser, world } = await loggedIn();
    await world.writer.add(aPost({ publishAt: T0 + HOUR, parts: [part("<b>hi</b>")] }));
    const pages: [string, string][] = [
      ["/dashboard/backlog", "<td>SCHEDULED</td>"],
      ["/dashboard/backlog?status=SCHEDULED&account=acc-1", "&lt;b&gt;hi&lt;/b&gt;"],
      ["/dashboard/calendar", "Week of 2026-10-27 (UTC)"],
      ["/dashboard/calendar?start=2026-11-02", "Mon 2026-11-02"],
      ["/dashboard/posts/post-1", "<h1>Post post-1</h1>"],
      ["/dashboard/accounts", "@musechat_one (Muse)"],
      ["/dashboard/personalities", "Muse (version 3)"],
      ["/dashboard/metrics", "@musechat_one: 0 posts read in the last 7 days"],
      ["/dashboard/costs", "All accounts"],
      ["/dashboard/media", "Stored bytes"],
      ["/dashboard/audit", "session.login"],
    ];
    for (const [path, text] of pages) {
      const page = await browser.page(path);
      expect([path, page.status]).toStrictEqual([path, 200]);
      expect(page.html).toContain(text);
      expect(page.html).toContain('<a href="/dashboard/audit">Audit</a>');
      expect(page.html).toContain(`name="_csrf" value="${browser.csrf}"`);
      expect(page.html).toContain(`src="${HTMX.path}"`);
      expect(page.html).toContain(`integrity="${HTMX.integrity}"`);
    }
    expect((await browser.page("/dashboard/backlog")).html).not.toContain("<b>hi</b>");
  });

  it("shows refusals with their status", async () => {
    const { browser } = await loggedIn();
    const missing = await browser.page("/dashboard/posts/nope");
    expect([missing.status, missing.html.includes("Not found.")]).toStrictEqual([404, true]);
    expect((await browser.page("/dashboard/backlog?status=LOST")).status).toBe(400);
    expect((await browser.page("/dashboard/calendar?start=soon")).status).toBe(400);
    expect((await browser.page("/dashboard/metrics?days=0")).status).toBe(400);
    expect((await browser.page("/dashboard/costs?days=x")).status).toBe(400);
    expect((await browser.page("/dashboard/audit?limit=9999")).status).toBe(400);
  });

  it("sets the security headers and never caches a page", async () => {
    const { browser } = await loggedIn();
    const response = await browser.get("/dashboard/backlog");
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-security-policy":
        "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self' https://x.com; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      // Not no-referrer: a form POST from a no-referrer page sends `Origin: null`, refused.
      "referrer-policy": "same-origin",
      "cache-control": "no-store",
    });
  });

  it("serves the vendored htmx with a long cache, without a session", async () => {
    const { browser } = await dashboard();
    const response = await browser.get(HTMX.path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await response.text()).toBe(HTMX.source);
  });
});

describe("the dashboard's commands, through forms", () => {
  it("approve, then the post page shows it scheduled", async () => {
    const { browser, world } = await loggedIn();
    await world.writer.add(aPost({ lifecycle: "PENDING_REVIEW" }));
    const page = await browser.page("/dashboard/posts/post-1");
    expect(page.html).toContain('action="/dashboard/posts/post-1/approve"');
    expect(page.html).toContain('action="/dashboard/posts/post-1/reject"');
    const response = await browser.post("/dashboard/posts/post-1/approve");
    expect([response.status, response.headers.get("location")]).toStrictEqual([
      303,
      "/dashboard/posts/post-1",
    ]);
    expect((await browser.page("/dashboard/posts/post-1")).html).toContain("SCHEDULED");
    const again = await browser.post("/dashboard/posts/post-1/approve");
    expect(again.status).toBe(409);
  });

  it("edit keeps media, reject, cancel, reschedule and delete", async () => {
    const { browser, world } = await loggedIn();
    const media = await world.stage(ACCOUNT, "PHOTO", "m-a");
    await world.writer.add(aPost({ parts: [part("a", undefined, [media.id]), part("b")] }));
    const page = await browser.page("/dashboard/posts/post-1");
    expect(page.html).toContain('<input type="hidden" name="media" value="m-a" />');
    const edited = await browser.post("/dashboard/posts/post-1/edit", {
      text: ["new a", "new b"],
      media: ["m-a", ""],
      publishAt: "2026-10-28T09:00",
    });
    expect(edited.status).toBe(303);
    const post = await world.reader.get(postId("post-1"));
    expect(post?.parts.map((p) => [p.text, p.media])).toStrictEqual([
      ["new a", [media.id]],
      ["new b", []],
    ]);
    expect((await browser.post("/dashboard/posts/post-1/cancel")).status).toBe(303);
    await world.writer.add(aPost({ id: postId("post-2"), lifecycle: "PENDING_REVIEW" }));
    expect((await browser.post("/dashboard/posts/post-2/reject")).status).toBe(303);
    await world.writer.add(aPost({ id: postId("post-3"), lifecycle: "MISSED" }));
    const reschedule = await browser.page("/dashboard/posts/post-3");
    expect(reschedule.html).toContain('action="/dashboard/posts/post-3/reschedule"');
    const moved = await browser.post("/dashboard/posts/post-3/reschedule", {
      publishAt: "2026-10-29T10:00",
    });
    expect(moved.status).toBe(303);
    await world.writer.add(
      aPost({
        id: postId("post-4"),
        lifecycle: "DONE",
        parts: [part("a", { kind: "NOT_FOUND", attemptAt: T0 })],
      }),
    );
    expect((await browser.page("/dashboard/posts/post-4")).html).toContain(
      'name="confirmedNotOnX"',
    );
    expect(
      (await browser.post("/dashboard/posts/post-4/reschedule", { publishAt: "2026-10-29T10:00" }))
        .status,
    ).toBe(400);
    expect(
      (
        await browser.post("/dashboard/posts/post-4/reschedule", {
          publishAt: "2026-10-29T10:00",
          confirmedNotOnX: "yes",
        })
      ).status,
    ).toBe(303);
    await world.writer.add(
      aPost({ id: postId("post-5"), lifecycle: "DONE", parts: [part("a", sentState("x-5"))] }),
    );
    await world.metrics.addSnapshots([
      {
        xPostId: xPostId("x-5"),
        accountId: ACCOUNT,
        takenAt: T0,
        impressions: 7,
        likes: 0,
        reposts: 0,
        replies: 0,
        quotes: 0,
        bookmarks: 0,
        urlLinkClicks: null,
        userProfileClicks: null,
      },
    ]);
    const published = await browser.page("/dashboard/posts/post-5");
    expect(published.html).toContain("<td>x-5</td>");
    expect(published.html).toContain("Delete on X");
    expect((await browser.post("/dashboard/posts/post-5/delete")).status).toBe(303);
    expect((await browser.page("/dashboard/posts/post-5")).html).toContain("DELETED");
  });

  it("the kill switch, the disclosure, the policy and a personality", async () => {
    const { browser, world } = await loggedIn();
    const accounts = await browser.page("/dashboard/accounts");
    expect(accounts.html).toContain('action="/dashboard/accounts/acc-1/status?to=PAUSED"');
    expect(accounts.html).toContain('hx-boost="false"');
    expect((await browser.post("/dashboard/accounts/acc-1/status?to=PAUSED")).status).toBe(303);
    expect((await world.accounts.list())[0]?.status).toBe("PAUSED");
    expect((await browser.page("/dashboard/accounts")).html).toContain("Activate");
    expect(
      (await browser.post("/dashboard/accounts/acc-1/disclosure", { bioConfirmed: "yes" })).status,
    ).toBe(303);
    expect((await world.accounts.list())[0]?.disclosure).toStrictEqual({
      bioConfirmed: true,
      automatedLabelConfirmed: false,
    });
    const policy = {
      mode: "REVIEW",
      dailyCap: "5",
      minGapMinutes: "10",
      quietStart: "22:00",
      quietEnd: "06:00",
      tz: "Europe/Paris",
      linkPolicy: "REFUSE",
      graceMinutes: "15",
    };
    expect((await browser.post("/dashboard/accounts/acc-1/policy", policy)).status).toBe(303);
    expect((await world.accounts.list())[0]?.policy).toMatchObject({ mode: "REVIEW", dailyCap: 5 });
    expect(
      (await browser.post("/dashboard/accounts/acc-1/policy", { ...policy, tz: "Mars/Base" }))
        .status,
    ).toBe(400);
    const saved = await browser.post("/dashboard/personalities", {
      id: "",
      name: "Second",
      voiceGuide: "dry",
      topics: "a\nb",
      dos: "",
      donts: "",
      examples: "",
    });
    expect(saved.status).toBe(303);
    expect((await world.personalities.list()).map((p) => p.name)).toStrictEqual(["Second", "Muse"]);
  });

  it("shows NEEDS_RECONNECT and a connect form per personality", async () => {
    const { browser, world } = await dashboard();
    await world.seedAccount({ status: "NEEDS_RECONNECT" });
    await world.personalities.save(aPersonality({ name: "Muse & Co" }));
    await browser.login();
    const page = await browser.page("/dashboard/accounts");
    expect(page.html).toContain("<strong>NEEDS_RECONNECT</strong>");
    expect(page.html).toContain("Publishing is refused until this account is reconnected on X.");
    expect(page.html).toContain("Muse &amp; Co");
    expect(page.html).toContain('name="personality"');
  });

  it("an empty dashboard says so", async () => {
    const { browser } = await dashboard();
    await browser.login();
    expect((await browser.page("/dashboard/accounts")).html).toContain("No accounts yet.");
    expect((await browser.page("/dashboard/accounts")).html).toContain(
      "Create a personality first.",
    );
    expect((await browser.page("/dashboard/backlog")).html).toContain("No posts.");
    expect((await browser.page("/dashboard/metrics")).html).toContain("No accounts yet.");
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
    await world.personalities.save(aPersonality());
    await browser.login();
    const session = browser.cookies.get("__Host-grokchat_session") ?? "";
    await browser.get("/dashboard/backlog", { authorization: "Bearer sekrit-bearer-token" });
    await browser.post("/oauth/x/start", { personality: "pers-1" });
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
      reports: Object.assign(Object.create(controllers.reports) as typeof controllers.reports, {
        media: () => Promise.reject(new TypeError("token=sekrit leaked in a message")),
      }),
    });
    const browser = new Browser((request, e) => failing.fetch(request, e), env);
    await browser.login();
    const response = await browser.get("/dashboard/media");
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
    expect(ORIGIN).toBe("https://grokchat.test");
  });
});
