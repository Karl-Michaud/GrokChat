/**
 * Tool results through main.ts and the MCP SDK client: refusals and schema checks, log content,
 * redaction, and every read tool (plan §3.4, I6, m3).
 */
import { describe, expect, it, vi } from "vitest";
import { xPostId } from "../../src/entities/identity/ids";
import { stubs } from "../../src/main";
import { aPersonality } from "../unit/support/builders";
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

describe("logging (m3)", () => {
  it("never logs the Authorization header, a token or the bot-clients secret", async () => {
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
      await call(
        { ...workerEnv, GROKCHAT_BOT_CLIENTS: `[${BOT_TOKEN}` },
        initialize("/mcp", { authorization: `Bearer ${BOT_TOKEN}` }),
      );
      const client = await connect(workerEnv);
      const original = stubs.accounts.get.bind(stubs.accounts);
      stubs.accounts.get = () => Promise.reject(new Error(`boom ${BOT_TOKEN}`));
      try {
        await client.callTool({ name: "get_policy", arguments: { account_id: account.id } });
      } finally {
        stubs.accounts.get = original;
      }
      expect(lines).toContain("grokchat mcp: GROKCHAT_BOT_CLIENTS refused (not_json)");
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
