/**
 * The deploy scripts' values against the Worker's own parsers, in workerd (GROKCHAT-13): a hash
 * set-admin-password builds verifies with password.ts, provision-secrets' token keys open what they
 * seal (and still open after a rotation), and import-bots carries the old bot list into D1.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TokenVault } from "../../src/frameworks/crypto/token_vault";
import { env } from "cloudflare:workers";
import { accountId, personId, xUserId } from "../../src/entities/identity/ids";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { BotAuthenticator } from "../../src/frameworks/mcp/bot_auth";
import { MIN_SESSION_SECRET } from "../../src/frameworks/web/config";
import { parsePasswordHash, Pbkdf2PasswordVerifier } from "../../src/frameworks/web/password";
import { checkBotClients } from "../../scripts/deploy/bot_clients.mjs";
import { importStatements } from "../../scripts/deploy/import_sql.mjs";
import { anAccount } from "../unit/support/builders";
import { freshStorage } from "./support/fresh_d1";
import {
  adminPasswordHash,
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

describe("import-bots (GROKCHAT-16): the live bot list into D1", () => {
  beforeEach(freshStorage);

  const stores = () => d1Stores(env.DB);
  const run = (statements: readonly string[]) =>
    env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
  const token = (char: string) => char.repeat(43);

  async function liveList() {
    for (const id of ["k-1", "k-2", "a-1"]) {
      await stores().accounts.save(anAccount({ id: accountId(id), xUserId: xUserId(`x-${id}`) }));
    }
    return checkBotClients([
      { id: "karl", tokenSha256: await sha256Hex(token("k")), accounts: ["k-1", "k-2"] },
      { id: "aaron", tokenSha256: await sha256Hex(token("a")), accounts: ["a-1", "gone"] },
    ]);
  }

  it("keeps every live token working, scoped to the same accounts, as `bot:<id>`", async () => {
    await run(importStatements(await liveList(), 5));
    const auth = new BotAuthenticator(stores().people, stores().owners);
    expect(await auth.authenticate(token("k"))).toStrictEqual({
      kind: "bot",
      scope: { botId: "karl", accountIds: ["k-1", "k-2"] },
    });
    expect(await auth.authenticate(token("a"))).toStrictEqual({
      kind: "bot",
      scope: { botId: "aaron", accountIds: ["a-1"] },
    });
    expect((await stores().people.list()).map((person) => [person.id, person.name])).toStrictEqual([
      ["aaron", "Aaron"],
      ["karl", "Karl"],
    ]);
    expect((await stores().people.get(personId("karl")))?.token?.createdAt).toBe(5);
  });

  it("is idempotent, and keeps the dashboard's rotations, renames and moves", async () => {
    const list = await liveList();
    await run(importStatements(list, 5));
    await run(importStatements(list, 6));
    expect(await stores().people.list()).toHaveLength(2);
    // On the dashboard: rotate Karl's token, move k-2 to Aaron, unassign a-1, rename Aaron.
    const karl = await stores().people.get(personId("karl"));
    const aaron = await stores().people.get(personId("aaron"));
    if (karl === null || aaron === null) {
      throw new Error("not imported");
    }
    await stores().people.save({
      ...karl,
      token: { sha256: await sha256Hex(token("r")), createdAt: 9 },
    });
    await stores().people.save({ ...aaron, name: "Aaron B" });
    await stores().owners.assign(accountId("k-2"), aaron.id);
    await stores().owners.assign(accountId("a-1"), null);
    await run(importStatements(list, 7));
    const auth = new BotAuthenticator(stores().people, stores().owners);
    expect(await auth.authenticate(token("k"))).toBeNull();
    expect(await auth.authenticate(token("r"))).toMatchObject({
      scope: { botId: "karl", accountIds: ["k-1"] },
    });
    expect((await stores().people.get(aaron.id))?.name).toBe("Aaron B");
    // a-1 had no person, so the import gives it back to Aaron: only what is missing is filled.
    expect(await stores().owners.accountsOf(aaron.id)).toStrictEqual(["a-1", "k-2"]);
  });

  it("skips a client whose token hash another person already holds", async () => {
    const list = await liveList();
    await stores().people.save({
      id: personId("someone"),
      name: "Someone",
      createdAt: 1,
      token: { sha256: list[0]?.tokenSha256 ?? "", createdAt: 1 },
    });
    await run(importStatements(list, 5));
    expect(await stores().people.get(personId("karl"))).toBeNull();
    expect(await stores().owners.accountsOf(personId("karl"))).toStrictEqual([]);
    expect(await stores().people.get(personId("aaron"))).not.toBeNull();
  });
});
