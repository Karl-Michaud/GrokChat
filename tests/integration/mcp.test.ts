/**
 * The MCP server through main.ts (plan §6 integration, R6): the SDK client lists the 13 tools,
 * creates a post that the in-memory publisher sends, and is refused without the right token.
 */
import { describe, expect, it } from "vitest";
import { xPostId } from "../../src/entities/identity/ids";
import type { Env } from "../../src/frameworks/env";
import { stubs } from "../../src/main";
import { aPersonality } from "../unit/support/builders";
import {
  BOT_TOKEN,
  body,
  botEnv,
  call,
  CLIENT_SECRET,
  connect,
  isError,
  OTHER_BOT_TOKEN,
  seedAccount,
} from "./support/mcp_client";

const TOOLS = [
  "cancel_post",
  "compare_posts",
  "create_post",
  "create_thread",
  "delete_post",
  "edit_post",
  "get_account_metrics",
  "get_personality",
  "get_policy",
  "get_post",
  "get_post_metrics",
  "list_backlog",
  "stage_media_from_url",
];

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "rmcp", version: "0" },
  },
};

function initialize(path: string, headers: Record<string, string>): Request {
  return new Request(`https://grokchat.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(INITIALIZE),
  });
}

describe("the MCP server's surface", () => {
  it("lists exactly the 13 tools, each described and with an input schema, and no resources", async () => {
    const client = await connect(await botEnv([]));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toStrictEqual(TOOLS);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe("object");
    }
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    await expect(client.listResources()).rejects.toThrow();
  });

  it.each(["/mcp", "/mcp/"])("serves %s itself, stateless JSON, with no redirect", async (path) => {
    const response = await call(
      await botEnv([]),
      initialize(path, { authorization: `Bearer ${BOT_TOKEN}` }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const json: { result: { serverInfo: { name: string } } } = await response.json();
    expect(json.result.serverInfo.name).toBe("grokchat");
  });

  it("works for a client connected at /mcp/", async () => {
    const client = await connect(await botEnv([]), BOT_TOKEN, "/mcp/");
    expect((await client.listTools()).tools).toHaveLength(13);
  });
});

describe("bot auth", () => {
  it.each([
    ["a wrong token", { authorization: `Bearer ${"f".repeat(64)}` }],
    ["no Authorization header", {}],
    ["a token without the Bearer scheme", { authorization: BOT_TOKEN }],
    ["a token shorter than 32 bytes", { authorization: "Bearer short-token" }],
  ])("answers 401 to %s, before any MCP processing", async (_name, headers) => {
    const response = await call(await botEnv([]), initialize("/mcp", headers));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(await response.json()).toStrictEqual({ error: "unauthorized" });
  });

  it("makes the SDK client fail to connect with a wrong token", async () => {
    await expect(connect(await botEnv([]), "e".repeat(64))).rejects.toThrow();
  });

  it.each([
    ["missing", undefined],
    ["not JSON", "not json"],
    ["not a list of clients", JSON.stringify({ id: "x" })],
  ])("fails closed with 503 when GROKCHAT_BOT_CLIENTS is %s", async (_name, raw) => {
    const entries = Object.entries({ ...(await botEnv([])), GROKCHAT_BOT_CLIENTS: raw });
    const workerEnv = Object.fromEntries(
      entries.filter(([, value]) => value !== undefined),
    ) as unknown as Env;
    const response = await call(
      workerEnv,
      initialize("/mcp", { authorization: `Bearer ${BOT_TOKEN}` }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({ error: "bot_auth_unavailable" });
  });

  it("gives each token its own scope: the other bot's token sees the other accounts", async () => {
    const account = await seedAccount();
    const workerEnv = await botEnv([], [account.id]);
    const mine = await connect(workerEnv, BOT_TOKEN);
    const theirs = await connect(workerEnv, OTHER_BOT_TOKEN);
    const args = { name: "get_policy", arguments: { account_id: account.id } };
    expect(body(await mine.callTool(args))).toStrictEqual({ error: "scope", part: null });
    expect(body(await theirs.callTool(args))).toMatchObject({ account_id: account.id });
  });
});

describe("create_post → published by the in-memory publisher (stub X)", () => {
  it("publishes now, and get_post shows the part SENT with its X id", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const created = await client.callTool({
      name: "create_post",
      arguments: { account_id: account.id, text: "hello from a bot", idempotency_key: "k-1" },
    });
    expect(isError(created)).toBe(false);
    const { post_id: postId, status } = body(created) as { post_id: string; status: string };
    expect(status).toBe("PUBLISHED");
    const onX = stubs.x.postsBy(account.id);
    expect(onX.map((post) => post.text)).toStrictEqual(["hello from a bot"]);

    const fetched = body(
      await client.callTool({ name: "get_post", arguments: { post_id: postId } }),
    );
    expect(fetched).toMatchObject({
      post: {
        post_id: postId,
        status: "PUBLISHED",
        parts: [{ state: "SENT", x_post_id: onX[0]?.id }],
      },
    });
  });

  it("returns the same post for a retried key, and refuses a changed request", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const args = { account_id: account.id, text: "once", idempotency_key: "k-retry" };
    const first = body(await client.callTool({ name: "create_post", arguments: args }));
    const again = body(await client.callTool({ name: "create_post", arguments: args }));
    expect(again).toMatchObject({ post_id: first["post_id"], duplicate: true });
    const changed = await client.callTool({
      name: "create_post",
      arguments: { ...args, text: "twice" },
    });
    expect(isError(changed)).toBe(true);
    expect(body(changed)).toStrictEqual({ error: "idempotency_mismatch", part: null });
    expect(stubs.x.postsBy(account.id)).toHaveLength(1);
  });

  it("publishes a thread in order, each part replying to the one before", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const created = await client.callTool({
      name: "create_thread",
      arguments: {
        account_id: account.id,
        parts: [{ text: "one" }, { text: "two" }],
        idempotency_key: "k-thread",
      },
    });
    expect(body(created)).toMatchObject({ status: "PUBLISHED" });
    const [first, second] = stubs.x.postsBy(account.id);
    expect([first?.text, second?.text]).toStrictEqual(["one", "two"]);
    expect(second?.inReplyTo).toBe(first?.id);
  });

  it("schedules a later post, which edit_post and cancel_post can still change", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const created = body(
      await client.callTool({
        name: "create_post",
        arguments: {
          account_id: account.id,
          text: "later",
          publish_at: later,
          idempotency_key: "k-l",
        },
      }),
    ) as { post_id: string; status: string };
    expect(created.status).toBe("SCHEDULED");
    const edited = await client.callTool({
      name: "edit_post",
      arguments: { post_id: created.post_id, parts: [{ text: "later, edited" }] },
    });
    expect(body(edited)).toMatchObject({
      post: { parts: [{ text: "later, edited" }], version: 2 },
    });
    const cancelled = await client.callTool({
      name: "cancel_post",
      arguments: { post_id: created.post_id },
    });
    expect(body(cancelled)).toMatchObject({ post: { status: "CANCELLED" } });
    expect(stubs.x.postsBy(account.id)).toHaveLength(0);
  });

  it("deletes a published post from X", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const { post_id: postId } = body(
      await client.callTool({
        name: "create_post",
        arguments: { account_id: account.id, text: "short-lived", idempotency_key: "k-d" },
      }),
    );
    const deleted = await client.callTool({ name: "delete_post", arguments: { post_id: postId } });
    expect(body(deleted)).toMatchObject({
      deleted: 1,
      incomplete: false,
      post: { status: "DELETED" },
    });
    expect(stubs.x.postsBy(account.id)).toHaveLength(0);
  });
});

describe("tool refusals and boundary checks", () => {
  it("refuses an over-long part as isError with the use case's code and the part index", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const result = await client.callTool({
      name: "create_post",
      arguments: { account_id: account.id, text: "x".repeat(281), idempotency_key: "k-long" },
    });
    expect(isError(result)).toBe(true);
    expect(body(result)).toStrictEqual({ error: "part_too_long", part: 0 });
    expect((result.content as { text: string }[])[0]?.text).toBe(
      '{"error":"part_too_long","part":0}',
    );
  });

  it.each([
    ["a publish_at without an offset", { publish_at: "2026-10-28T09:00:00" }],
    ["a missing idempotency_key", { idempotency_key: undefined }],
    ["five media ids", { media_ids: ["a", "b", "c", "d", "e"] }],
  ])("rejects %s at the schema, before any use case runs", async (_name, change) => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const result = await client.callTool({
      name: "create_post",
      arguments: { account_id: account.id, text: "x", idempotency_key: "k-schema", ...change },
    });
    expect(isError(result)).toBe(true);
    expect(stubs.x.postsBy(account.id)).toHaveLength(0);
    expect(await stubs.reader.list({ accountIds: [account.id] })).toHaveLength(0);
  });

  it("answers a failing use case with code internal, never the error's message", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const original = stubs.accounts.get.bind(stubs.accounts);
    stubs.accounts.get = () => Promise.reject(new Error(`boom ${BOT_TOKEN}`));
    try {
      const result = await client.callTool({
        name: "get_policy",
        arguments: { account_id: account.id },
      });
      expect(isError(result)).toBe(true);
      expect(body(result)).toStrictEqual({ error: "internal", part: null });
      expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
    } finally {
      stubs.accounts.get = original;
    }
  });
});

describe("presenters redact secrets (I6, R8)", () => {
  it("removes the caller's token and the deployment's secrets from every string", async () => {
    const account = await seedAccount();
    await stubs.personalities.save(
      aPersonality({
        id: account.personalityId,
        voiceGuide: `never print ${BOT_TOKEN}`,
        examples: [`the secret is ${CLIENT_SECRET}`, "Bearer abc.def"],
      }),
    );
    const client = await connect(await botEnv([account.id]));
    const result = await client.callTool({
      name: "get_personality",
      arguments: { account_id: account.id },
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain(BOT_TOKEN);
    expect(text).not.toContain(CLIENT_SECRET);
    expect(text).not.toContain("abc.def");
    expect(body(result)).toMatchObject({
      personality: {
        voice_guide: "never print [redacted]",
        examples: ["the secret is [redacted]", "Bearer [redacted]"],
      },
    });
  });
});

describe("the read tools", () => {
  it("answer policy, personality, backlog and metrics for an account in scope", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const created = body(
      await client.callTool({
        name: "create_post",
        arguments: { account_id: account.id, text: "measured", idempotency_key: "k-m" },
      }),
    ) as { post_id: string };
    const sent = stubs.x.postsBy(account.id)[0];
    const now = Date.now();
    await stubs.metrics.addSnapshots([
      {
        xPostId: xPostId(sent?.id ?? ""),
        accountId: account.id,
        takenAt: now,
        impressions: 10,
        likes: 2,
        reposts: 1,
        replies: 0,
        quotes: 0,
        bookmarks: 1,
        urlLinkClicks: null,
        userProfileClicks: null,
      },
    ]);
    const window = {
      from: new Date(now - 60_000).toISOString(),
      to: new Date(now + 60_000).toISOString(),
    };
    const tool = async (name: string, args: Record<string, unknown>) =>
      body(await client.callTool({ name, arguments: args }));

    expect(await tool("get_policy", { account_id: account.id })).toMatchObject({
      status: "ACTIVE",
      disclosure: { bio_confirmed: true, automated_label_confirmed: true },
      policy: { mode: "AUTO", daily_cap: 10, min_gap_minutes: 30, link_policy: "ALLOW" },
    });
    expect(await tool("get_personality", { account_id: account.id })).toMatchObject({
      personality: { name: "Muse", topics: ["music"] },
    });
    expect(await tool("list_backlog", { statuses: ["PUBLISHED"], ...window })).toMatchObject({
      posts: [{ post_id: created.post_id }],
    });
    expect(await tool("get_post_metrics", { post_id: created.post_id })).toMatchObject({
      parts: [{ impressions: 10, likes: 2 }],
    });
    expect(await tool("get_account_metrics", { account_id: account.id, ...window })).toMatchObject({
      posts: 1,
      totals: { impressions: 10, bookmarks: 1 },
    });
    expect(
      await tool("compare_posts", { account_id: account.id, sort_by: "likes", ...window }),
    ).toMatchObject({ ranked: [{ likes: 2 }] });
  });
});
