/**
 * End to end through main.ts in workerd (GROKCHAT-14, plan §6 integration): the production
 * Worker, its account Durable Object and real local D1 and R2, with only `fetch` stubbed for X.
 * The owner connects an X account through the dashboard's OAuth flow and sets it up; a bot then
 * uses that account over MCP: its `create_post` waits for review, the owner approves it, the
 * publish tick (`scheduled()`) sends it through the real X drivers, the dashboard's backlog shows
 * it with its X id, and an hour later the metrics tick reads its metrics.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../../src/entities/accounts/account";
import { xUserId } from "../../src/entities/identity/ids";
import { HOUR, MINUTE } from "../../src/entities/time/instant";
import { CRONS, type CronName } from "../../src/frameworks/cron/dispatch";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import type { Env } from "../../src/frameworks/env";
import worker from "../../src/main";
import { freshStorage } from "./support/fresh_d1";
import { body, botEnv, connect } from "./support/mcp_client";
import { stubX, type XWire } from "./support/x_wire";
import { Browser, webEnv } from "./web/browser";

type IncomingRequest = Parameters<typeof worker.fetch>[0];

let x: XWire;
beforeEach(async () => {
  await freshStorage();
  x = stubX();
  x.me = { id: "x-e2e-1", username: "e2e_muse" };
});
afterEach(() => {
  vi.useRealTimers();
  x.restore();
});

const browserFor = (workerEnv: Env): Browser =>
  new Browser(
    (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
    workerEnv,
  );

async function tick(name: CronName, workerEnv: Env): Promise<void> {
  const controller = createScheduledController({ cron: CRONS[name], scheduledTime: Date.now() });
  await worker.scheduled(controller, workerEnv);
}

/** The owner logs in, adds a personality and connects the X user `x.me` through X's OAuth. */
async function connectThroughDashboard(browser: Browser): Promise<Account> {
  expect((await browser.login()).status).toBe(303);
  const saved = await browser.post("/dashboard/personalities", {
    ...{ id: "", name: "E2E Muse", voiceGuide: "", topics: "", dos: "", donts: "", examples: "" },
  });
  expect(saved.status).toBe(303);
  const page = await browser.page("/dashboard/personalities");
  const personality = /name="id" value="([0-9a-f-]{36})"/.exec(page.html)?.[1] ?? "";
  const started = await browser.post("/oauth/x/start", { personality });
  const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
  const finished = await browser.get(`/oauth/x/finish?code=code-e2e&state=${state}`);
  expect([finished.status, finished.headers.get("location")]).toStrictEqual([
    303,
    "/dashboard/accounts?connected=%40e2e_muse",
  ]);
  // X saw the code exchange and the who-am-I, nothing else.
  expect(x.calls()).toStrictEqual(["POST /2/oauth2/token", "GET /2/users/me"]);
  const account = await d1Stores(env.DB).accounts.findByXUserId(xUserId("x-e2e-1"));
  expect(account).toMatchObject({ handle: "e2e_muse", status: "PAUSED" });
  if (account === null) {
    throw new Error("the connect stored no account");
  }
  return account;
}

/** The owner confirms the disclosure, asks to review every post, and activates the account. */
async function setUpAccount(browser: Browser, account: Account): Promise<void> {
  await browser.page("/dashboard/accounts");
  const base = `/dashboard/accounts/${account.id}`;
  const policy = {
    mode: "REVIEW",
    dailyCap: "10",
    minGapMinutes: "0",
    quietStart: "",
    quietEnd: "",
    tz: "UTC",
    linkPolicy: "REFUSE",
    graceMinutes: "30",
  };
  for (const [path, form] of [
    ["/disclosure", { bioConfirmed: "yes", automatedLabelConfirmed: "yes" }],
    ["/policy", policy],
    ["/status?to=ACTIVE", {}],
  ] as const) {
    expect((await browser.post(`${base}${path}`, form)).status).toBeLessThan(400);
  }
  expect(await d1Stores(env.DB).accounts.get(account.id)).toMatchObject({
    status: "ACTIVE",
    disclosure: { bioConfirmed: true, automatedLabelConfirmed: true },
    policy: { mode: "REVIEW", minGap: 0 },
  });
}

const tool = async (client: Client, name: string, args: Record<string, unknown>) =>
  body(await client.callTool({ name, arguments: args }));

describe("dashboard connect → bot create_post → scheduled() → dashboard backlog → metrics", () => {
  it("runs the whole path on the production graph, with only X's HTTP faked", async () => {
    const dashboardEnv = await webEnv();
    const browser = browserFor(dashboardEnv);
    const account = await connectThroughDashboard(browser);
    await setUpAccount(browser, account);

    // The bot's deployment scopes it to the account the dashboard connected.
    const bot = await connect(await botEnv([account.id], [], dashboardEnv));
    expect(await tool(bot, "get_policy", { account_id: account.id })).toMatchObject({
      status: "ACTIVE",
      policy: { mode: "REVIEW" },
    });
    const created = await tool(bot, "create_post", {
      account_id: account.id,
      text: "hello from a grok bot",
      idempotency_key: "e2e-1",
    });
    expect(created).toMatchObject({ status: "PENDING_REVIEW" });
    const postId = String(created["post_id"]);
    const detail = `/dashboard/posts/${postId}`;

    // The owner finds it in the backlog and approves it; nothing is on X yet.
    const pending = await browser.page("/dashboard/backlog");
    expect(pending.html).toContain(`href="${detail}"`);
    expect(pending.html).toContain("hello from a grok bot");
    await browser.page(detail);
    expect((await browser.post(`${detail}/approve`)).status).toBeLessThan(400);
    expect(x.emulator.posts.size).toBe(0);

    // The publish tick sends it from the account's Durable Object, with the connect's token.
    await tick("publish", dashboardEnv);
    const [sent, ...others] = x.emulator.posts.values();
    expect(others).toStrictEqual([]);
    expect(sent?.text).toBe("hello from a grok bot");
    const create = x.seen.find(
      (request) => request.method === "POST" && request.url.pathname === "/2/tweets",
    );
    expect(create?.headers.get("authorization")).toBe("Bearer access-2");
    const xId = sent?.id ?? "";

    // The dashboard's backlog lists it as published; its page shows the part SENT with the X id.
    const published = await browser.page("/dashboard/backlog?status=PUBLISHED");
    expect(published.html).toContain(`href="${detail}"`);
    expect(published.html).toContain("PUBLISHED");
    expect((await browser.page(detail)).html).toContain(`[SENT ${xId}]`);
    expect(await tool(bot, "get_post", { post_id: postId })).toMatchObject({
      post: { status: "PUBLISHED", parts: [{ state: "SENT", x_post_id: xId }] },
    });

    // An hour later the metrics tick reads it; the bot and the dashboard both see the numbers.
    expect(await tool(bot, "get_post_metrics", { post_id: postId })).toMatchObject({ parts: [] });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + HOUR + MINUTE });
    const before = x.calls().length;
    await tick("metrics", dashboardEnv);
    expect(x.calls().slice(before)).toStrictEqual(["GET /2/tweets"]);
    expect(await tool(bot, "get_post_metrics", { post_id: postId })).toMatchObject({
      parts: [{ x_post_id: xId, impressions: 100, likes: 10 }],
    });
    expect((await browser.page(detail)).html).toMatch(
      new RegExp(`<td>${xId}</td>[\\s\\S]*<td>100</td>`),
    );
  });
});
