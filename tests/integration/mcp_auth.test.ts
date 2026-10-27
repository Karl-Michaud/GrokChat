/** Bot auth and the MCP shim's pieces, in workerd (crypto.subtle.timingSafeEqual is Workers-only). */
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotAuthenticator, bearerToken, MIN_TOKEN_LENGTH } from "../../src/frameworks/mcp/bot_auth";
import { secretsOf } from "../../src/frameworks/mcp/mcp_route";
import { callToolResult } from "../../src/frameworks/mcp/mcp_server";
import { BOT_TOKEN, OTHER_BOT_TOKEN, sha256Hex } from "./support/mcp_client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bearerToken", () => {
  const long = "t".repeat(MIN_TOKEN_LENGTH);

  it("takes the token after the Bearer scheme, in any case, with trailing space", () => {
    expect(bearerToken(`Bearer ${long}`)).toBe(long);
    expect(bearerToken(`bearer   ${long}  `)).toBe(long);
  });

  it.each([
    ["no header", null],
    ["an empty header", ""],
    ["no scheme", long],
    ["another scheme", `Basic ${long}`],
    ["two tokens", `Bearer ${long} ${long}`],
    ["a token one character short", `Bearer ${"t".repeat(MIN_TOKEN_LENGTH - 1)}`],
  ])("refuses %s", (_name, header) => {
    expect(bearerToken(header)).toBeNull();
  });

  it("asks for at least 32 bytes' worth of token: 43 characters", () => {
    expect(MIN_TOKEN_LENGTH).toBe(43);
  });
});

async function authenticator(): Promise<BotAuthenticator> {
  return new BotAuthenticator([
    { id: "first", tokenSha256: await sha256Hex(OTHER_BOT_TOKEN), accounts: ["a-1"] },
    { id: "second", tokenSha256: await sha256Hex(BOT_TOKEN), accounts: ["a-2", "a-3"] },
    { id: "third", tokenSha256: await sha256Hex("z".repeat(64)), accounts: [] },
  ]);
}

describe("BotAuthenticator", () => {
  it("finds the entry whose hash matches and scopes the actor to exactly its accounts", async () => {
    expect(await (await authenticator()).authenticate(BOT_TOKEN)).toStrictEqual({
      kind: "bot",
      scope: { botId: "second", accountIds: ["a-2", "a-3"] },
    });
    expect(await (await authenticator()).authenticate(OTHER_BOT_TOKEN)).toMatchObject({
      scope: { botId: "first", accountIds: ["a-1"] },
    });
  });

  it("refuses a token that matches no entry", async () => {
    expect(await (await authenticator()).authenticate("y".repeat(64))).toBeNull();
  });

  it("refuses everyone when there are no entries", async () => {
    expect(await new BotAuthenticator([]).authenticate(BOT_TOKEN)).toBeNull();
  });

  it("compares with every entry, timing-safe, even after a match (no early exit)", async () => {
    const auth = await authenticator();
    const compare = vi.spyOn(crypto.subtle, "timingSafeEqual");
    await auth.authenticate(OTHER_BOT_TOKEN);
    expect(compare).toHaveBeenCalledTimes(3);
    for (const [presented, stored] of compare.mock.calls) {
      expect((presented as Uint8Array).byteLength).toBe(32);
      expect((stored as Uint8Array).byteLength).toBe(32);
    }
  });

  it("keeps the matching entry when later entries do not match", async () => {
    const auth = new BotAuthenticator([
      { id: "only", tokenSha256: await sha256Hex(BOT_TOKEN), accounts: ["a"] },
      { id: "later", tokenSha256: await sha256Hex("q".repeat(64)), accounts: ["b"] },
    ]);
    expect(await auth.authenticate(BOT_TOKEN)).toMatchObject({ scope: { botId: "only" } });
  });
});

describe("secretsOf", () => {
  it("lists the caller's token and every configured secret, each token key on its own", () => {
    const secrets = secretsOf(
      {
        ...env,
        X_CLIENT_SECRET: "client-secret",
        GROKCHAT_TOKEN_KEYS: "k2:aaaa, k1:bbbb",
        GROKCHAT_SESSION_SECRET: "session",
        GROKCHAT_ADMIN_PASSWORD_HASH: "pbkdf2$hash",
      },
      "the-token",
    );
    expect(secrets).toStrictEqual([
      "the-token",
      "client-secret",
      "k2:aaaa, k1:bbbb",
      "session",
      "pbkdf2$hash",
      "k2:aaaa",
      "k1:bbbb",
    ]);
  });

  it("skips secrets that are not set or blank", () => {
    expect(secretsOf({ ...env, X_CLIENT_SECRET: "  " }, "tok")).toStrictEqual(["tok"]);
  });
});

describe("callToolResult", () => {
  it("carries the body as JSON text and as structured content, with isError", () => {
    expect(callToolResult({ isError: true, body: { error: "scope", part: null } })).toStrictEqual({
      content: [{ type: "text", text: '{"error":"scope","part":null}' }],
      structuredContent: { error: "scope", part: null },
      isError: true,
    });
    expect(callToolResult({ isError: false, body: { a: 1 } }).isError).toBe(false);
  });
});
