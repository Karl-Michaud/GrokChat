import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { accountId, postId, xUserId } from "../../src/entities/identity/ids";
import { DAY, HOUR } from "../../src/entities/time/instant";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import worker from "../../src/main";
import {
  aFollowerSnapshot,
  anAccount,
  aPost,
  aSnapshot,
  part,
  sentState,
} from "../unit/support/builders";
import { Browser, ORIGIN, webEnv, X_CLIENT_ID } from "./web/browser";

type IncomingRequest = Parameters<typeof worker.fetch>[0];

/** The dashboard through the deployed entry point, on D1 and the real X OAuth connector. */
describe("the dashboard through main.ts", () => {
  it("logs in, starts an X connect with no personality, and keeps /health", async () => {
    const env = await webEnv();
    const browser = new Browser(
      (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
      env,
    );
    expect((await browser.get("/dashboard/analytics")).status).toBe(303);
    expect((await browser.login()).status).toBe(303);
    expect((await browser.page("/dashboard/posts")).html).toContain("No posts yet");
    const started = await browser.post("/oauth/x/start", {});
    expect(started.status).toBe(303);
    const location = new URL(started.headers.get("location") ?? "");
    expect(location.origin).toBe("https://x.com");
    expect(location.searchParams.get("client_id")).toBe(X_CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/oauth/x/callback`);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toMatch(/^[0-9a-f-]{36}$/);
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const page of ["analytics", "posts", "accounts", "activity", "analytics?range=all"]) {
      expect((await browser.page(`/dashboard/${page}`)).status).toBe(200);
    }
    expect((await browser.get("/health")).status).toBe(200);
  });

  it("has no personalities table, and refuses to start a connect without the X app's secrets", async () => {
    const env = await webEnv({ X_CLIENT_ID: "" });
    const browser = new Browser(
      (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
      env,
    );
    expect((await browser.login()).status).toBe(303);
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'personalities'",
    ).all();
    expect(tables.results).toStrictEqual([]);
    const columns = await env.DB.prepare("SELECT name FROM pragma_table_info('accounts')").all<{
      name: string;
    }>();
    expect(columns.results.map((column) => column.name)).not.toContain("personality_id");
    expect((await browser.get("/dashboard/personalities")).status).toBe(404);
    expect((await browser.post("/oauth/x/start", {})).status).toBe(500);
  });

  it("answers 503 on the dashboard while unconfigured, and 404 elsewhere", async () => {
    const env = await webEnv({ GROKCHAT_SESSION_SECRET: "" });
    const browser = new Browser(
      (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
      env,
    );
    expect((await browser.get("/dashboard/login")).status).toBe(503);
    expect((await browser.get("/nope")).status).toBe(404);
  });
});

describe("the dashboard's pages on D1, through main.ts (GROKCHAT-15)", () => {
  it("every page renders over real data, filters work, and commands still need CSRF and the Origin", async () => {
    const env = await webEnv();
    const stores = d1Stores(env.DB);
    const account = anAccount({
      id: accountId("main-acc"),
      xUserId: xUserId("main-x"),
      handle: "main_muse",
    });
    await stores.accounts.save(account);
    const now = Date.now();
    await stores.writer.add(
      aPost({
        id: postId("main-live"),
        accountId: account.id,
        lifecycle: "DONE",
        publishAt: now - DAY,
        parts: [part("live on x", sentState("main-x1", now - DAY))],
      }),
    );
    await stores.writer.add(
      aPost({
        id: postId("main-next"),
        accountId: account.id,
        publishAt: now + HOUR,
        parts: [part("next up")],
      }),
    );
    await stores.metrics.addSnapshots([
      aSnapshot("main-x1", now - HOUR, 3_210, { accountId: account.id }),
    ]);
    const snapshot = aFollowerSnapshot(now - HOUR, 987, account.id);
    await stores.followers.claim(account.id, snapshot.day, now - HOUR);
    await stores.followers.record(snapshot);
    await stores.audit.append({
      at: now - DAY,
      actor: "bot:muse",
      action: "post.create",
      accountId: account.id,
      postId: postId("main-live"),
      detail: "",
    });
    const browser = new Browser(
      (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
      env,
    );
    expect((await browser.login()).status).toBe(303);
    const pages: readonly (readonly [string, string])[] = [
      ["/dashboard/analytics", "3.2K"],
      ["/dashboard/analytics?range=24h&metric=likes&account=main-acc", "Last 24 hours"],
      ["/dashboard/analytics?range=all", "987"],
      ["/dashboard/posts?status=PUBLISHED&sort=impressions&dir=desc", "live on x"],
      ["/dashboard/posts?account=main-acc&status=SCHEDULED", "next up"],
      ["/dashboard/posts/main-live", "https://x.com/main_muse/status/main-x1"],
      ["/dashboard/accounts", "@main_muse"],
      ["/dashboard/activity?actor=bot&kind=posts", "Created a post"],
    ];
    for (const [path, text] of pages) {
      const page = await browser.page(path);
      expect([path, page.status, page.html.includes(text)]).toStrictEqual([path, 200, true]);
    }
    const filtered = await browser.page("/dashboard/posts?status=SCHEDULED");
    expect(filtered.html).not.toContain("live on x");
    const status = `/dashboard/accounts/${account.id}/status?to=PAUSED`;
    expect((await browser.post(status, {}, { csrf: null })).status).toBe(403);
    expect((await browser.post(status, {}, { origin: "https://elsewhere.test" })).status).toBe(403);
    expect((await stores.accounts.get(account.id))?.status).toBe("ACTIVE");
    expect((await browser.post(status)).status).toBe(303);
    expect((await stores.accounts.get(account.id))?.status).toBe("PAUSED");
    const theme = await browser.post("/dashboard/theme", { back: "/dashboard/accounts" });
    expect(theme.headers.get("location")).toBe("/dashboard/accounts");
    expect((await browser.page("/dashboard/accounts")).html).toContain('data-theme="light"');
  });
});
