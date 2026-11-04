/**
 * Tool results through main.ts and the MCP SDK client, on the production graph (D1, the account's
 * Durable Object, X faked at `fetch` only): refusals and schema checks, log content, redaction,
 * and every read tool (plan §3.4, I6, m3).
 */
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postId, xPostId } from "../../src/entities/identity/ids";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { aPost, part } from "../unit/support/builders";
import {
  BOT_TOKEN,
  body,
  botEnv,
  call,
  CLIENT_SECRET,
  connect,
  initialize,
  isError,
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

const stores = () => d1Stores(env.DB);

/**
 * A D1 binding that fails every statement with a message carrying the bot's token, except bot
 * auth's two reads (the person by token hash, their accounts), so the call gets past auth.
 */
const brokenDb = (): D1Database =>
  ({
    prepare: (query: string) => {
      if (query.includes("FROM people") || query.includes("WHERE person_id = ?1")) {
        return env.DB.prepare(query);
      }
      throw new Error(`boom ${BOT_TOKEN}`);
    },
  }) as unknown as D1Database;

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
    expect(x.calls()).toStrictEqual([]);
    expect(await stores().reader.list({ accountIds: [account.id] })).toHaveLength(0);
  });

  it("answers a failing use case with code internal, never the error's message", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id], [], { DB: brokenDb() }));
    const result = await client.callTool({
      name: "get_policy",
      arguments: { account_id: account.id },
    });
    expect(isError(result)).toBe(true);
    expect(body(result)).toStrictEqual({ error: "internal", part: null });
    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
  });
});

describe("logging (m3)", () => {
  it("never logs the Authorization header or a token, even when auth or a tool fails", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(capture),
    );
    try {
      const account = await seedAccount();
      const workerEnv = await botEnv([account.id]);
      await call(workerEnv, initialize("/mcp", { authorization: `Bearer ${"f".repeat(64)}` }));
      const authDown = {
        prepare: () => {
          throw new Error(`down ${BOT_TOKEN}`);
        },
      } as unknown as D1Database;
      await call(
        { ...workerEnv, DB: authDown },
        initialize("/mcp", { authorization: `Bearer ${BOT_TOKEN}` }),
      );
      const client = await connect({ ...workerEnv, DB: brokenDb() });
      await client.callTool({ name: "get_policy", arguments: { account_id: account.id } });
      expect(lines).toContain("grokchat mcp: bot auth unavailable");
      expect(lines).toContain("grokchat mcp: tool get_policy failed");
      const all = lines.join("\n");
      expect(all).not.toContain(BOT_TOKEN);
      expect(all).not.toContain("f".repeat(64));
      expect(all.toLowerCase()).not.toContain("authorization");
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});

describe("presenters redact secrets (I6, R8)", () => {
  it("removes the caller's token and the deployment's secrets from every string", async () => {
    const account = await seedAccount();
    const id = postId(`redact-${account.id}`);
    await stores().writer.add(
      aPost({
        id,
        accountId: account.id,
        parts: [
          part(`never print ${BOT_TOKEN}`),
          part(`the secret is ${CLIENT_SECRET} Bearer abc.def`),
        ],
      }),
    );
    const client = await connect(await botEnv([account.id]));
    const result = await client.callTool({ name: "get_post", arguments: { post_id: id } });
    const text = JSON.stringify(result);
    expect(text).not.toContain(BOT_TOKEN);
    expect(text).not.toContain(CLIENT_SECRET);
    expect(text).not.toContain("abc.def");
    expect(body(result)).toMatchObject({
      post: {
        parts: [
          { text: "never print [redacted]" },
          { text: "the secret is [redacted] Bearer [redacted]" },
        ],
      },
    });
  });
});

describe("the read tools", () => {
  it("answer policy, backlog and metrics for an account in scope", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const created = body(
      await client.callTool({
        name: "create_post",
        arguments: { account_id: account.id, text: "measured", idempotency_key: "k-m" },
      }),
    ) as { post_id: string };
    const [sent] = x.emulator.posts.values();
    const now = Date.now();
    await stores().metrics.addSnapshots([
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
