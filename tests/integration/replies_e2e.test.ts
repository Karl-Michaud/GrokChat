/**
 * Replies end to end through main.ts in workerd (GROKCHAT-17, incident 2026-10-28): X allows API
 * replies only to the account's own posts, so a bot may reply only to a post its account
 * published through GrokChat, and a reply X refuses never disconnects the account. Only X's HTTP
 * is faked; D1, the account's Durable Object and the real X drivers run.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransportResult } from "../../src/frameworks/x_http/transport";
import type { Account } from "../../src/entities/accounts/account";
import { CRONS } from "../../src/frameworks/cron/dispatch";
import type { Env } from "../../src/frameworks/env";
import worker from "../../src/main";
import type { SeenRequest } from "../contract/support/x_fixtures";
import { connectThroughDashboard, setUpAccount } from "./support/dashboard_flow";
import { freshStorage } from "./support/fresh_d1";
import { body, botEnv, connect } from "./support/mcp_client";
import { stubX, type XWire } from "./support/x_wire";
import { Browser, webEnv } from "./web/browser";

type IncomingRequest = Parameters<typeof worker.fetch>[0];

/** A 403 whose wording the content regex does not know: what the fail-safe once read as auth. */
const REFUSAL = {
  title: "Forbidden",
  type: "about:blank",
  status: 403,
  detail: "You are not allowed to reply to this post.",
};

let x: XWire;
beforeEach(async () => {
  await freshStorage();
  x = stubX();
  x.me = { id: "x-reply-1", username: "reply_muse" };
});
afterEach(() => {
  vi.useRealTimers();
  x.restore();
});

interface Setup {
  readonly browser: Browser;
  readonly workerEnv: Env;
  readonly account: Account;
  readonly bot: Client;
}

async function setUp(): Promise<Setup> {
  const workerEnv = await webEnv();
  const browser = new Browser(
    (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
    workerEnv,
  );
  const account = await connectThroughDashboard(browser, x);
  await setUpAccount(browser, account);
  const bot = await connect(await botEnv([account.id], [], workerEnv));
  return { browser, workerEnv, account, bot };
}

const tool = async (client: Client, name: string, args: Record<string, unknown>) =>
  body(await client.callTool({ name, arguments: args }));

async function publishTick(workerEnv: Env): Promise<void> {
  const controller = createScheduledController({ cron: CRONS.publish, scheduledTime: Date.now() });
  await worker.scheduled(controller, workerEnv);
}

/** A bot's create, approved on the dashboard (the account is in review mode), then published. */
async function createAndPublish(
  s: Setup,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const created = await tool(s.bot, "create_post", { account_id: s.account.id, ...args });
  expect(created).toMatchObject({ status: "PENDING_REVIEW" });
  const detail = `/dashboard/posts/${String(created["post_id"])}`;
  await s.browser.page(detail);
  expect((await s.browser.post(`${detail}/approve`)).status).toBeLessThan(400);
  await publishTick(s.workerEnv);
  return tool(s.bot, "get_post", { post_id: created["post_id"] });
}

/** X answers every create with REFUSAL; everything else as usual. */
function refuseCreates(): void {
  const handle = x.emulator.handle;
  vi.spyOn(x.emulator, "handle").mockImplementation((request: SeenRequest): TransportResult => {
    if (request.method === "POST" && request.url.pathname === "/2/tweets") {
      return { kind: "response", response: Response.json(REFUSAL, { status: 403 }) };
    }
    return handle(request);
  });
}

const postCount = async (): Promise<number> =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM posts").first<{ n: number }>())?.n ?? -1;

const createAudits = async (): Promise<readonly string[]> =>
  (
    await env.DB.prepare(
      "SELECT detail FROM audit_events WHERE action = 'x.create' ORDER BY rowid",
    ).all<{ detail: string }>()
  ).results.map((row) => row.detail);

const accountStatus = async (account: Account): Promise<string | undefined> =>
  (
    await env.DB.prepare("SELECT status FROM accounts WHERE id = ?1")
      .bind(account.id)
      .first<{ status: string }>()
  )?.status;

describe("a bot replies only to its account's own posts", () => {
  it("a reply to an own published post is accepted and sent as a reply to it", async () => {
    const s = await setUp();
    const original = await createAndPublish(s, { text: "first", idempotency_key: "orig" });
    const parts = (original["post"] as { parts: { x_post_id: string }[] }).parts;
    const ownId = parts[0]?.x_post_id ?? "";
    expect(ownId).toMatch(/^\d+$/);

    const reply = await createAndPublish(s, {
      text: "and a follow-up",
      in_reply_to: `https://x.com/${x.me.username}/status/${ownId}`,
      idempotency_key: "reply-own",
    });
    expect(reply).toMatchObject({ post: { status: "PUBLISHED", in_reply_to: ownId } });
    const replyId = (reply["post"] as { post_id: string }).post_id;
    const page = (await s.browser.page(`/dashboard/posts/${replyId}`)).html;
    expect(page).toContain(`https://x.com/i/web/status/${ownId}`);
    expect([...x.emulator.posts.values()].map((post) => [post.text, post.inReplyTo])).toStrictEqual(
      [
        ["first", null],
        ["and a follow-up", ownId],
      ],
    );
  });

  it("a reply to a foreign post id or URL is refused with reply_target_not_own; nothing is stored", async () => {
    const s = await setUp();
    for (const [tool_name, args] of [
      ["create_post", { text: "hi", in_reply_to: "1850000000000000001" }],
      [
        "create_post",
        { text: "hi", in_reply_to: "https://x.com/XDevelopers/status/1850000000000000002" },
      ],
      [
        "create_thread",
        { parts: [{ text: "a" }, { text: "b" }], in_reply_to: "1850000000000000003" },
      ],
    ] as const) {
      const result = await s.bot.callTool({
        name: tool_name,
        arguments: { account_id: s.account.id, idempotency_key: `k-${tool_name}`, ...args },
      });
      expect(body(result)).toMatchObject({ error: "reply_target_not_own" });
      expect(result.isError).toBe(true);
    }
    expect(await postCount()).toBe(0);
    expect(x.calls().filter((call) => call === "POST /2/tweets")).toStrictEqual([]);
  });
});

describe("a 403 from X on a create", () => {
  it("on a reply: the post is FAILED, the account stays ACTIVE, X's wording is audited", async () => {
    const s = await setUp();
    const original = await createAndPublish(s, { text: "first", idempotency_key: "orig" });
    const ownId =
      (original["post"] as { parts: { x_post_id: string }[] }).parts[0]?.x_post_id ?? "";
    refuseCreates();
    const reply = await createAndPublish(s, {
      text: "a reply X refuses",
      in_reply_to: ownId,
      idempotency_key: "reply-refused",
    });
    expect(reply).toMatchObject({
      post: { status: "FAILED", parts: [{ state: "REJECTED" }] },
    });
    expect(await accountStatus(s.account)).toBe("ACTIVE");
    const audits = await createAudits();
    expect(audits.at(-1)).toBe(`reply_refused: x_403: Forbidden: ${REFUSAL.detail}`);

    // Not retried: another tick sends nothing.
    const creates = x.calls().filter((call) => call === "POST /2/tweets").length;
    await publishTick(s.workerEnv);
    expect(x.calls().filter((call) => call === "POST /2/tweets")).toHaveLength(creates);
  });

  it("on an original post: unchanged, the account needs a reconnect, X's wording is audited", async () => {
    const s = await setUp();
    refuseCreates();
    const post = await createAndPublish(s, { text: "plain", idempotency_key: "plain" });
    expect(post).toMatchObject({ post: { status: "SCHEDULED" } });
    expect(await accountStatus(s.account)).toBe("NEEDS_RECONNECT");
    expect(await createAudits()).toStrictEqual([
      `needs_reconnect: x_403: Forbidden: ${REFUSAL.detail}`,
    ]);
  });
});
