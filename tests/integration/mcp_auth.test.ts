/** Bot auth and the MCP shim's pieces, in workerd over a real local D1. */
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotAuthenticator, bearerToken, MIN_TOKEN_LENGTH } from "../../src/frameworks/mcp/bot_auth";
import { secretsOf } from "../../src/frameworks/mcp/mcp_route";
import { callToolResult } from "../../src/frameworks/mcp/mcp_server";
import { personId } from "../../src/entities/identity/ids";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import {
  BOT_TOKEN,
  OTHER_BOT_TOKEN,
  seedAccount,
  seedPerson,
  sha256Hex,
} from "./support/mcp_client";

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

describe("BotAuthenticator (GROKCHAT-16: people in D1)", () => {
  const people = () => d1Stores(env.DB);

  it("finds the person whose token hash matches, scoped to exactly their accounts, read per call", async () => {
    const a1 = await seedAccount();
    const a2 = await seedAccount();
    await seedPerson(personId("auth-first"), OTHER_BOT_TOKEN, [a1.id]);
    await seedPerson(personId("auth-second"), BOT_TOKEN, [a2.id]);
    const auth = new BotAuthenticator(people().people, people().owners);
    expect(await auth.authenticate(BOT_TOKEN)).toStrictEqual({
      kind: "bot",
      scope: { botId: "auth-second", accountIds: [a2.id] },
    });
    expect(await auth.authenticate(OTHER_BOT_TOKEN)).toMatchObject({
      scope: { botId: "auth-first", accountIds: [a1.id] },
    });
    // The same authenticator sees a new assignment on its next call: nothing is cached.
    await people().owners.assign(a1.id, personId("auth-second"));
    expect(await auth.authenticate(BOT_TOKEN)).toMatchObject({
      scope: { accountIds: [a1.id, a2.id].sort() },
    });
  });

  it("refuses a token that matches no person, and a person with no token", async () => {
    await people().people.save({
      id: personId("auth-tokenless"),
      name: "auth-tokenless",
      createdAt: 0,
      token: null,
    });
    const auth = new BotAuthenticator(people().people, people().owners);
    expect(await auth.authenticate("y".repeat(64))).toBeNull();
  });

  it("hashes the token as SHA-256 hex of its UTF-8, the format the import and add-bot used", async () => {
    await seedPerson(personId("auth-hash"), "é".repeat(43), []);
    const auth = new BotAuthenticator(people().people, people().owners);
    expect(await auth.authenticate("é".repeat(43))).toMatchObject({
      scope: { botId: "auth-hash" },
    });
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
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
    expect(
      secretsOf({ ...env, X_CLIENT_SECRET: "  ", GROKCHAT_TOKEN_KEYS: "  " }, "tok"),
    ).toStrictEqual(["tok"]);
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
