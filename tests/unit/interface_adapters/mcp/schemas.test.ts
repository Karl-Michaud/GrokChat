import { describe, expect, it } from "vitest";
import {
  EVERY_STATUS_LISTED,
  TOOL_SCHEMAS,
} from "../../../../src/interface_adapters/schemas/mcp_tool_schemas";
import { TOOL_CATALOG, TOOL_NAMES } from "../../../../src/interface_adapters/mcp/tool_catalog";

const ok = (name: keyof typeof TOOL_SCHEMAS, value: unknown) =>
  TOOL_SCHEMAS[name].safeParse(value).success;

const CREATE = { account_id: "a", text: "hi", idempotency_key: "k" };
const THREAD = { account_id: "a", parts: [{ text: "hi" }], idempotency_key: "k" };
const WINDOW = { account_id: "a", from: "2026-10-27T00:00:00Z", to: "2026-10-28T00:00:00+02:00" };

describe("tool input schemas", () => {
  it("has a schema for exactly the 13 catalogued tools", () => {
    expect(Object.keys(TOOL_SCHEMAS).sort()).toStrictEqual([...TOOL_NAMES].sort());
    expect(TOOL_NAMES).toHaveLength(13);
  });

  it("lists every derived status for list_backlog (compile-time check)", () => {
    expect(EVERY_STATUS_LISTED).toBe(true);
    for (const status of ["DRAFT", "DELETE_INCOMPLETE", "UNKNOWN_OUTCOME", "MISSED"]) {
      expect(ok("list_backlog", { statuses: [status] })).toBe(true);
    }
    expect(ok("list_backlog", { statuses: ["DONE"] })).toBe(false);
  });

  it("checks ids: 1 to 128 characters", () => {
    expect(ok("get_post", { post_id: "p" })).toBe(true);
    expect(ok("get_post", { post_id: "p".repeat(128) })).toBe(true);
    expect(ok("get_post", { post_id: "" })).toBe(false);
    expect(ok("get_post", { post_id: "p".repeat(129) })).toBe(false);
    expect(ok("get_post", {})).toBe(false);
  });

  it("create_post: text up to 4,000 raw characters, up to 4 media ids, a key", () => {
    expect(ok("create_post", CREATE)).toBe(true);
    expect(ok("create_post", { ...CREATE, text: "x".repeat(4_000) })).toBe(true);
    expect(ok("create_post", { ...CREATE, text: "x".repeat(4_001) })).toBe(false);
    expect(ok("create_post", { ...CREATE, media_ids: ["1", "2", "3", "4"] })).toBe(true);
    expect(ok("create_post", { ...CREATE, media_ids: ["1", "2", "3", "4", "5"] })).toBe(false);
    expect(ok("create_post", { ...CREATE, media_ids: [""] })).toBe(false);
    expect(ok("create_post", { account_id: "a", text: "hi" })).toBe(false);
  });

  it("refuses a publish_at without an offset (m5) and accepts Z or ±hh:mm", () => {
    expect(ok("create_post", { ...CREATE, publish_at: "2026-10-28T09:00:00Z" })).toBe(true);
    expect(ok("create_post", { ...CREATE, publish_at: "2026-10-28T09:00:00-05:00" })).toBe(true);
    expect(ok("create_post", { ...CREATE, publish_at: "2026-10-28T09:00:00" })).toBe(false);
    expect(ok("create_post", { ...CREATE, publish_at: "tomorrow" })).toBe(false);
  });

  it("create_thread: 1 to 25 parts", () => {
    const parts = (n: number) => Array.from({ length: n }, () => ({ text: "p" }));
    expect(ok("create_thread", THREAD)).toBe(true);
    expect(ok("create_thread", { ...THREAD, parts: parts(25) })).toBe(true);
    expect(ok("create_thread", { ...THREAD, parts: parts(26) })).toBe(false);
    expect(ok("create_thread", { ...THREAD, parts: [] })).toBe(false);
    expect(ok("create_thread", { ...THREAD, idempotency_key: undefined })).toBe(false);
  });

  it("keeps each thread part's text and media ids, and requires the text", () => {
    const parsed = TOOL_SCHEMAS.create_thread.parse({
      ...THREAD,
      parts: [{ text: "a", media_ids: ["m"] }],
    });
    expect(parsed.parts).toStrictEqual([{ text: "a", media_ids: ["m"] }]);
    expect(ok("create_thread", { ...THREAD, parts: [{ media_ids: ["m"] }] })).toBe(false);
  });

  it("list_accounts takes nothing", () => {
    expect(TOOL_SCHEMAS.list_accounts.parse({})).toStrictEqual({});
    expect(TOOL_SCHEMAS.list_accounts.parse({ extra: 1 })).toStrictEqual({});
  });

  it("the account tools need an account id", () => {
    expect(ok("get_policy", {})).toBe(false);
    expect(TOOL_SCHEMAS.get_policy.parse({ account_id: "a" })).toStrictEqual({ account_id: "a" });
  });

  it("stage_media_from_url: a URL of 1 to 2,048 characters", () => {
    expect(ok("stage_media_from_url", { account_id: "a", url: "https://h/a" })).toBe(true);
    expect(ok("stage_media_from_url", { account_id: "a", url: "" })).toBe(false);
    const long = `https://h/${"a".repeat(2_048 - 10)}`;
    expect(ok("stage_media_from_url", { account_id: "a", url: long })).toBe(true);
    expect(ok("stage_media_from_url", { account_id: "a", url: `${long}a` })).toBe(false);
  });

  it("edit_post: parts and time are optional", () => {
    expect(ok("edit_post", { post_id: "p" })).toBe(true);
    expect(ok("edit_post", { post_id: "p", parts: [] })).toBe(false);
    expect(ok("edit_post", { post_id: "p", publish_at: "2026-10-28T09:00:00" })).toBe(false);
  });

  it("the metrics tools need a window; compare_posts a known metric", () => {
    expect(ok("get_account_metrics", WINDOW)).toBe(true);
    expect(ok("get_account_metrics", { account_id: "a", from: WINDOW.from })).toBe(false);
    expect(ok("compare_posts", { ...WINDOW, sort_by: "impressions" })).toBe(true);
    expect(ok("compare_posts", { ...WINDOW, sort_by: "followers" })).toBe(false);
    expect(ok("list_backlog", {})).toBe(true);
    expect(ok("list_backlog", { from: "yesterday" })).toBe(false);
  });
});

describe("tool catalog", () => {
  it("sets both hints on every tool, as booleans", () => {
    for (const name of TOOL_NAMES) {
      expect(typeof TOOL_CATALOG[name].readOnly).toBe("boolean");
      expect(typeof TOOL_CATALOG[name].destructive).toBe("boolean");
    }
  });

  it("marks the reads read-only and only delete_post destructive", () => {
    const readOnly = TOOL_NAMES.filter((name) => TOOL_CATALOG[name].readOnly).sort();
    expect(readOnly).toStrictEqual([
      "compare_posts",
      "get_account_metrics",
      "get_policy",
      "get_post",
      "get_post_metrics",
      "list_accounts",
      "list_backlog",
    ]);
    const destructive = TOOL_NAMES.filter((name) => TOOL_CATALOG[name].destructive);
    expect(destructive).toStrictEqual(["delete_post"]);
  });

  it("names other tools as Grok shows them, grokchat___<tool>, and only tools that exist", () => {
    for (const name of TOOL_NAMES) {
      const { description } = TOOL_CATALOG[name];
      expect(description).toContain("isError");
      const mentioned = [...description.matchAll(/grokchat___(\w+)/g)].map((m) => m[1]);
      for (const other of mentioned) {
        expect(TOOL_NAMES).toContain(other);
      }
      const bare = TOOL_NAMES.filter(
        (other) => other !== name && new RegExp(`(?<!grokchat___)\\b${other}\\b`).test(description),
      );
      expect(bare).toStrictEqual([]);
    }
    expect(TOOL_CATALOG.create_post.description).toContain("grokchat___stage_media_from_url");
  });
});
