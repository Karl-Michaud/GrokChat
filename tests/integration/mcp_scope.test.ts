/**
 * I2 / R7 through the whole MCP stack (main.ts, bot auth, SDK, controllers, interactors): every
 * tool aimed at another account's account id, post id or media id is refused with isError and a
 * code, writes nothing, and the scope refusal is audited. Unknown ids fail closed.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Account } from "../../src/entities/accounts/account";
import { stagedMediaId } from "../../src/entities/identity/ids";
import { stubs } from "../../src/main";
import { aMedia } from "../unit/support/builders";
import { body, botEnv, connect, isError, OTHER_BOT_TOKEN, seedAccount } from "./support/mcp_client";

interface World {
  readonly mine: Account;
  readonly theirs: Account;
  readonly theirPost: string;
  readonly myScheduled: string;
  readonly theirMedia: string;
  readonly client: Client;
}

let world: World;

const WINDOW = { from: "2026-01-01T00:00:00Z", to: "2030-01-01T00:00:00Z" };
const LATER = "2030-06-01T12:00:00+02:00";

async function setUp(): Promise<World> {
  const mine = await seedAccount();
  const theirs = await seedAccount();
  const workerEnv = await botEnv([mine.id], [theirs.id]);
  const other = await connect(workerEnv, OTHER_BOT_TOKEN);
  const published = await other.callTool({
    name: "create_post",
    arguments: { account_id: theirs.id, text: "theirs", idempotency_key: "scope-theirs" },
  });
  const client = await connect(workerEnv);
  const scheduled = await client.callTool({
    name: "create_post",
    arguments: {
      account_id: mine.id,
      text: "mine",
      publish_at: LATER,
      idempotency_key: "scope-mine",
    },
  });
  const media = aMedia({ id: stagedMediaId(`media-of-${theirs.id}`), ownerAccountId: theirs.id });
  await stubs.media.save(media);
  // The fixtures exist as intended, so a refusal below is not an accident of a missing row.
  expect(body(published)).toMatchObject({ status: "PUBLISHED" });
  expect(body(scheduled)).toMatchObject({ status: "SCHEDULED" });
  return {
    mine,
    theirs,
    theirPost: String(body(published)["post_id"]),
    myScheduled: String(body(scheduled)["post_id"]),
    theirMedia: media.id,
    client,
  };
}

type Case = readonly [tool: string, args: (w: World) => Record<string, unknown>, code: string];

/** Every tool × every id it takes, each owned by the other account. */
const OTHER_ACCOUNT_IDS: readonly Case[] = [
  ["create_post", (w) => ({ account_id: w.theirs.id, text: "x", idempotency_key: "s-1" }), "scope"],
  [
    "create_thread",
    (w) => ({ account_id: w.theirs.id, parts: [{ text: "x" }], idempotency_key: "s-2" }),
    "scope",
  ],
  [
    "stage_media_from_url",
    (w) => ({ account_id: w.theirs.id, url: "https://media.example/a.png" }),
    "scope",
  ],
  ["list_backlog", (w) => ({ account_id: w.theirs.id }), "scope"],
  ["get_account_metrics", (w) => ({ account_id: w.theirs.id, ...WINDOW }), "scope"],
  ["compare_posts", (w) => ({ account_id: w.theirs.id, sort_by: "likes", ...WINDOW }), "scope"],
  ["get_personality", (w) => ({ account_id: w.theirs.id }), "scope"],
  ["get_policy", (w) => ({ account_id: w.theirs.id }), "scope"],
];

const OTHER_POST_IDS: readonly Case[] = [
  ["edit_post", (w) => ({ post_id: w.theirPost, publish_at: LATER }), "scope"],
  ["cancel_post", (w) => ({ post_id: w.theirPost }), "scope"],
  ["delete_post", (w) => ({ post_id: w.theirPost }), "scope"],
  ["get_post", (w) => ({ post_id: w.theirPost }), "scope"],
  ["get_post_metrics", (w) => ({ post_id: w.theirPost }), "scope"],
];

const OTHER_MEDIA_IDS: readonly Case[] = [
  [
    "create_post",
    (w) => ({
      account_id: w.mine.id,
      text: "x",
      media_ids: [w.theirMedia],
      idempotency_key: "s-3",
    }),
    "media_not_owned",
  ],
  [
    "create_thread",
    (w) => ({
      account_id: w.mine.id,
      parts: [{ text: "x" }, { text: "y", media_ids: [w.theirMedia] }],
      idempotency_key: "s-4",
    }),
    "media_not_owned",
  ],
  [
    "edit_post",
    (w) => ({ post_id: w.myScheduled, parts: [{ text: "x", media_ids: [w.theirMedia] }] }),
    "media_not_owned",
  ],
];

/** An id that exists nowhere: refused, never treated as "no restriction". */
const UNKNOWN_IDS: readonly Case[] = [
  ["create_post", () => ({ account_id: "nobody", text: "x", idempotency_key: "s-5" }), "not_found"],
  ["get_policy", () => ({ account_id: "nobody" }), "not_found"],
  ["get_account_metrics", () => ({ account_id: "nobody", ...WINDOW }), "scope"],
  ["compare_posts", () => ({ account_id: "nobody", sort_by: "likes", ...WINDOW }), "scope"],
  ["list_backlog", () => ({ account_id: "nobody" }), "scope"],
  ["get_post", () => ({ post_id: "no-such-post" }), "not_found"],
  ["delete_post", () => ({ post_id: "no-such-post" }), "not_found"],
];

function snapshot(): string {
  return JSON.stringify({
    posts: [...stubs.table.rows],
    media: [...stubs.media.rows],
    x: [...stubs.x.posts],
    costs: stubs.costs.entries.length,
  });
}

async function expectRefused(tool: string, args: Record<string, unknown>, code: string) {
  const before = snapshot();
  const audited = stubs.audit.events.length;
  const result = await world.client.callTool({ name: tool, arguments: args });
  expect(isError(result)).toBe(true);
  expect(body(result)).toMatchObject({ error: code });
  expect(snapshot()).toBe(before);
  const written = stubs.audit.events.slice(audited);
  if (code === "scope") {
    expect(
      written.map((event) => [event.actor, event.action.startsWith("refused."), event.detail]),
    ).toStrictEqual([["bot:bot-mine", true, "scope"]]);
  } else {
    expect(written.every((event) => event.action.startsWith("refused."))).toBe(true);
  }
}

beforeAll(async () => {
  world = await setUp();
});

describe("I2 / R7 over MCP: every tool × account, post and media id of another account", () => {
  it.each(OTHER_ACCOUNT_IDS)("%s with the other account's account id", async (tool, args, code) => {
    await expectRefused(tool, args(world), code);
  });

  it.each(OTHER_POST_IDS)("%s with the other account's post id", async (tool, args, code) => {
    await expectRefused(tool, args(world), code);
  });

  it.each(OTHER_MEDIA_IDS)("%s with the other account's media id", async (tool, args, code) => {
    await expectRefused(tool, args(world), code);
  });

  it.each(UNKNOWN_IDS)("%s with an unknown id fails closed", async (tool, args, code) => {
    await expectRefused(tool, args(world), code);
  });

  it("covers every tool", () => {
    const covered = new Set(
      [...OTHER_ACCOUNT_IDS, ...OTHER_POST_IDS, ...OTHER_MEDIA_IDS].map(([tool]) => tool),
    );
    expect(covered.size).toBe(13);
  });

  it("list_backlog without account_id shows only the bot's own accounts", async () => {
    const result = body(await world.client.callTool({ name: "list_backlog", arguments: {} }));
    const posts = result["posts"] as { account_id: string }[];
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((post) => post.account_id === world.mine.id)).toBe(true);
  });
});
