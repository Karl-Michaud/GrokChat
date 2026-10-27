/**
 * The deploy scripts' values against the Worker's own parsers, in workerd (GROKCHAT-13): a hash
 * set-admin-password builds verifies with password.ts, provision-secrets' token keys open what they
 * seal (and still open after a rotation), and an add-bot list authenticates its token.
 */
import { describe, expect, it } from "vitest";
import { TokenVault } from "../../src/frameworks/crypto/token_vault";
import { BotAuthenticator, bearerToken } from "../../src/frameworks/mcp/bot_auth";
import { MIN_SESSION_SECRET } from "../../src/frameworks/web/config";
import { parsePasswordHash, Pbkdf2PasswordVerifier } from "../../src/frameworks/web/password";
import { parseBotClients } from "../../src/interface_adapters/schemas/bot_clients_schema";
import { withBotClient } from "../../scripts/deploy/bot_clients.mjs";
import {
  adminPasswordHash,
  newBotToken,
  newestTokenKeyOnly,
  newSessionSecret,
  newTokenKey,
  rotatedTokenKeys,
  sha256Hex,
} from "../../scripts/deploy/secret_values.mjs";

describe("set-admin-password's hash", () => {
  it("verifies with the dashboard's verifier, and refuses another password", async () => {
    const stored = parsePasswordHash(await adminPasswordHash("a long enough password"));
    expect(stored).not.toBeNull();
    if (stored === null) {
      return;
    }
    expect(stored.salt.length).toBe(16);
    const verifier = new Pbkdf2PasswordVerifier(stored);
    expect(await verifier.verify("a long enough password")).toBe(true);
    expect(await verifier.verify("a long enough passwore")).toBe(false);
  });

  it("uses a new random salt each time", async () => {
    const [a, b] = await Promise.all([
      adminPasswordHash("same password!"),
      adminPasswordHash("same password!"),
    ]);
    expect(a).not.toBe(b);
  });
});

describe("provision-secrets' token keys and session secret", () => {
  it("seal and open with the vault; after a rotation old values still open and re-seal", async () => {
    const first = newTokenKey();
    const sealed = await TokenVault.fromSecret(first).seal("tokens", "account-1");
    const rotated = rotatedTokenKeys(first);
    const vault = TokenVault.fromSecret(rotated);
    expect(await vault.open(sealed, "account-1")).toStrictEqual({
      plaintext: "tokens",
      current: false,
    });
    const resealed = await vault.seal("tokens", "account-1");
    const newest = TokenVault.fromSecret(newestTokenKeyOnly(rotated));
    expect(await newest.open(resealed, "account-1")).toStrictEqual({
      plaintext: "tokens",
      current: true,
    });
    await expect(newest.open(sealed, "account-1")).rejects.toThrow("no longer holds");
  });

  it("gives a session secret long enough for the dashboard", () => {
    expect(newSessionSecret().length).toBeGreaterThanOrEqual(MIN_SESSION_SECRET);
  });
});

describe("add-bot's client list", () => {
  it("parses as GROKCHAT_BOT_CLIENTS and authenticates the bot's token, scoped to its accounts", async () => {
    const token = newBotToken();
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    const other = { id: "other", tokenSha256: await sha256Hex(newBotToken()), accounts: ["acc-9"] };
    const list = withBotClient([other], {
      id: "muse-bot",
      tokenSha256: await sha256Hex(token),
      accounts: ["acc-1", "acc-2"],
    });
    const parsed = parseBotClients(JSON.stringify(list));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const auth = new BotAuthenticator(parsed.clients);
    expect(await auth.authenticate(token)).toStrictEqual({
      kind: "bot",
      scope: { botId: "muse-bot", accountIds: ["acc-1", "acc-2"] },
    });
    expect(await auth.authenticate(newBotToken())).toBeNull();
  });
});
