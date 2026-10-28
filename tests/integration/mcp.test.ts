/**
 * The MCP server through main.ts (plan §6 integration, R6) on the production graph: the SDK client
 * lists the 15 tools, creates posts that the account's Durable Object sends through the real X
 * drivers (X faked at `fetch` only), stages media through the real https fetcher into R2, and is
 * refused without the right token.
 */
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../src/frameworks/env";
import { hostRefusalMessage } from "../../src/interface_adapters/mcp/tool_views";
import {
  BOT_TOKEN,
  body,
  botEnv,
  call,
  connect,
  isError,
  initialize,
  OTHER_BOT_TOKEN,
  seedAccount,
} from "./support/mcp_client";
import { stubX, type XWire } from "./support/x_wire";

let x: XWire;
beforeEach(() => {
  x = stubX();
});
afterEach(() => {
  x.restore();
});

/** The posts on (emulated) X, oldest first. */
const onX = () => [...x.emulator.posts.values()];

/** The JSON bodies of every create X received. */
const creates = () =>
  x.seen
    .filter((request) => request.method === "POST" && request.url.pathname === "/2/tweets")
    .map((request) => JSON.parse(request.body) as { media?: { media_ids: string[] } });

const TOOLS = [
  "cancel_post",
  "compare_posts",
  "create_post",
  "create_thread",
  "delete_post",
  "edit_post",
  "get_account_metrics",
  "get_policy",
  "get_post",
  "get_post_metrics",
  "list_accounts",
  "list_backlog",
  "list_media",
  "stage_media_from_url",
];

describe("the MCP server's surface", () => {
  it("lists exactly the 15 tools (no get_personality: Grok owns personalities), each described and with an input schema, and no resources", async () => {
    const client = await connect(await botEnv([]));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toStrictEqual(TOOLS);
    expect(tools.map((tool) => tool.name)).not.toContain("get_personality");
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
    expect((await client.listTools()).tools).toHaveLength(15);
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

  it("fails closed with 503 when D1 cannot be read during auth, quoting nothing", async () => {
    const broken = {
      prepare: () => {
        throw new Error(`boom ${BOT_TOKEN}`);
      },
    } as unknown as D1Database;
    const workerEnv: Env = { ...(await botEnv([])), DB: broken };
    const response = await call(
      workerEnv,
      initialize("/mcp", { authorization: `Bearer ${BOT_TOKEN}` }),
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toStrictEqual({ error: "bot_auth_unavailable" });
    expect(text).not.toContain(BOT_TOKEN);
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

describe("create_post → published by the account's Durable Object on the real X drivers", () => {
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
    const sent = onX();
    expect(sent.map((post) => post.text)).toStrictEqual(["hello from a bot"]);

    const fetched = body(
      await client.callTool({ name: "get_post", arguments: { post_id: postId } }),
    );
    expect(fetched).toMatchObject({
      post: {
        post_id: postId,
        status: "PUBLISHED",
        parts: [{ state: "SENT", x_post_id: sent[0]?.id }],
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
    expect(onX()).toHaveLength(1);
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
    const [first, second] = onX();
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
    expect(onX()).toHaveLength(0);
    expect(x.calls()).toStrictEqual([]);
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
    expect(onX()).toHaveLength(0);
    expect(x.calls().filter((line) => line.startsWith("DELETE "))).toHaveLength(1);
  });
});

describe("stage_media_from_url → R2 → create_post with the media", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("stages from an allowed host and posts with the staged photo", async () => {
    const account = await seedAccount();
    const url = `https://media.example/${account.id}.png`;
    x.web.set(url, () => new Response(PNG, { headers: { "content-type": "image/png" } }));
    const client = await connect(await botEnv([account.id]));
    const staged = await client.callTool({
      name: "stage_media_from_url",
      arguments: { account_id: account.id, url },
    });
    expect(body(staged)).toMatchObject({ kind: "PHOTO", size_bytes: PNG.length });
    const mediaId = String(body(staged)["media_id"]);
    const created = await client.callTool({
      name: "create_post",
      arguments: {
        account_id: account.id,
        text: "with a photo",
        media_ids: [mediaId],
        idempotency_key: "k-media",
      },
    });
    expect(body(created)).toMatchObject({ status: "PUBLISHED" });
    expect(creates()[0]?.media?.media_ids).toHaveLength(1);
    const stored = await env.MEDIA.list({ prefix: "media/" });
    expect(stored.objects.map((object) => object.size)).toContain(PNG.length);
  });

  it.each([
    [
      "a redirect off the allowlist",
      () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/a.png" } }),
      "host_not_allowed",
    ],
    [
      "Cloudflare's 403 for a private address",
      () => new Response("error code: 1003", { status: 403 }),
      "host_not_allowed",
    ],
    ["a page that is not media", () => new Response("<html></html>"), "bad_type"],
  ])("refuses %s through the real fetcher, storing nothing", async (_name, answer, code) => {
    const account = await seedAccount();
    const url = `https://media.example/${account.id}-refused.png`;
    x.web.set(url, answer);
    const client = await connect(await botEnv([account.id]));
    const staged = await client.callTool({
      name: "stage_media_from_url",
      arguments: { account_id: account.id, url },
    });
    expect(body(staged)).toStrictEqual(
      code === "host_not_allowed"
        ? { error: code, part: null, message: hostRefusalMessage(["media.example"]) }
        : { error: code, part: null },
    );
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM staged_media WHERE owner_account_id = ?",
    )
      .bind(account.id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("refuses every host when GROKCHAT_MEDIA_HOSTS is not set", async () => {
    const account = await seedAccount();
    const { GROKCHAT_MEDIA_HOSTS: hosts, ...rest } = await botEnv([account.id]);
    expect(hosts).toBe("media.example");
    const client = await connect(rest);
    const staged = await client.callTool({
      name: "stage_media_from_url",
      arguments: { account_id: account.id, url: "https://media.example/a.png" },
    });
    expect(body(staged)).toStrictEqual({
      error: "host_not_allowed",
      part: null,
      message: hostRefusalMessage([]),
    });
    expect(String(body(staged)["message"])).toContain("GROKCHAT_MEDIA_HOSTS is empty");
  });

  it("reads the allowlist case-insensitively, trimming spaces and empty entries", async () => {
    const account = await seedAccount();
    const url = `https://cdn.example/${account.id}.png`;
    x.web.set(url, () => new Response(PNG));
    const workerEnv = await botEnv([account.id], [], {
      GROKCHAT_MEDIA_HOSTS: " other.example, ,CDN.Example ",
    });
    const client = await connect(workerEnv);
    const staged = await client.callTool({
      name: "stage_media_from_url",
      arguments: { account_id: account.id, url },
    });
    expect(isError(staged)).toBe(false);
  });
});
