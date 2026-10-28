/** Contracts for the people (GROKCHAT-16): the person repository, account owners, token issuer. */
import { expect, it } from "vitest";
import { accountId, personId, xUserId } from "../../src/entities/identity/ids";
import type { AccountOwners } from "../../src/use_cases/ports/account_owners";
import type { AccountRepository } from "../../src/use_cases/ports/account_repository";
import type { BotTokenIssuer } from "../../src/use_cases/ports/bot_token_issuer";
import type { PersonRepository } from "../../src/use_cases/ports/person_repository";
import { anAccount, aPerson, T0 } from "../unit/support/builders";

export interface PeopleStores {
  readonly people: PersonRepository;
  readonly owners: AccountOwners;
  readonly accounts: AccountRepository;
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

export function personRepositoryContract(make: () => PeopleStores): void {
  it("save, get, list by name ignoring case, find by name and by token hash; save replaces", async () => {
    const { people } = make();
    const zed = aPerson({ id: personId("p-1"), name: "zed" });
    const amy = aPerson({
      id: personId("p-2"),
      name: "Amy",
      token: { sha256: HASH_A, createdAt: T0 + 5 },
    });
    const bob = aPerson({ id: personId("p-3"), name: "bob" });
    await people.save(zed);
    await people.save(amy);
    await people.save(bob);
    expect(await people.get(personId("p-2"))).toStrictEqual(amy);
    expect(await people.get(personId("nobody"))).toBeNull();
    expect(await people.list()).toStrictEqual([amy, bob, zed]);
    expect(await people.findByName("AMY")).toStrictEqual(amy);
    expect(await people.findByName("Am")).toBeNull();
    expect(await people.findByTokenHash(HASH_A)).toStrictEqual(amy);
    expect(await people.findByTokenHash(HASH_B)).toBeNull();
    const rotated = { ...amy, name: "Amy Pond", token: { sha256: HASH_B, createdAt: T0 + 9 } };
    await people.save(rotated);
    expect(await people.get(amy.id)).toStrictEqual(rotated);
    expect(await people.findByTokenHash(HASH_A)).toBeNull();
    expect(await people.findByTokenHash(HASH_B)).toStrictEqual(rotated);
    await people.save({ ...rotated, token: null });
    expect(await people.findByTokenHash(HASH_B)).toBeNull();
    expect((await people.get(amy.id))?.token).toBeNull();
  });

  it("delete removes the person, its token and its assignments, and nobody else's", async () => {
    const { people, owners, accounts } = make();
    const kept = aPerson({ id: personId("p-kept"), name: "Kept" });
    const gone = aPerson({
      id: personId("p-gone"),
      name: "Gone",
      token: { sha256: HASH_A, createdAt: T0 },
    });
    await people.save(kept);
    await people.save(gone);
    for (const id of ["a-1", "a-2", "a-3"]) {
      await accounts.save(anAccount({ id: accountId(id), xUserId: xUserId(`x-${id}`) }));
    }
    await owners.assign(accountId("a-1"), gone.id);
    await owners.assign(accountId("a-2"), kept.id);
    await owners.assign(accountId("a-3"), gone.id);
    await people.delete(gone.id);
    expect(await people.get(gone.id)).toBeNull();
    expect(await people.findByTokenHash(HASH_A)).toBeNull();
    expect(await owners.accountsOf(gone.id)).toStrictEqual([]);
    expect(await owners.list()).toStrictEqual([{ accountId: accountId("a-2"), personId: kept.id }]);
    expect(await accounts.get(accountId("a-1"))).not.toBeNull();
    await people.delete(personId("never"));
    expect(await people.list()).toStrictEqual([kept]);
  });
}

export function accountOwnersContract(make: () => PeopleStores): void {
  it("assigns at most one person per account, unassigns, lists by id, and ignores unknown accounts", async () => {
    const { owners, accounts } = make();
    const karl = personId("karl");
    const aaron = personId("aaron");
    for (const id of ["b", "a", "c"]) {
      await accounts.save(anAccount({ id: accountId(id), xUserId: xUserId(`x-${id}`) }));
    }
    expect(await owners.list()).toStrictEqual([]);
    await owners.assign(accountId("b"), karl);
    await owners.assign(accountId("a"), karl);
    await owners.assign(accountId("c"), aaron);
    expect(await owners.accountsOf(karl)).toStrictEqual([accountId("a"), accountId("b")]);
    await owners.assign(accountId("b"), aaron);
    expect(await owners.accountsOf(karl)).toStrictEqual([accountId("a")]);
    expect(await owners.accountsOf(aaron)).toStrictEqual([accountId("b"), accountId("c")]);
    await owners.assign(accountId("c"), null);
    expect(await owners.list()).toStrictEqual([
      { accountId: accountId("a"), personId: karl },
      { accountId: accountId("b"), personId: aaron },
    ]);
    await owners.assign(accountId("ghost"), karl);
    expect(await owners.accountsOf(karl)).toStrictEqual([accountId("a")]);
  });

  it("saving an account keeps its owner", async () => {
    const { owners, accounts } = make();
    const account = anAccount({ id: accountId("kept"), xUserId: xUserId("x-kept") });
    await accounts.save(account);
    await owners.assign(account.id, personId("karl"));
    await accounts.save({ ...account, status: "PAUSED" });
    expect(await owners.accountsOf(personId("karl"))).toStrictEqual([account.id]);
    expect((await accounts.get(account.id))?.status).toBe("PAUSED");
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function tokenIssuerContract(make: () => BotTokenIssuer): void {
  it("issues distinct base64url tokens of 43 characters with their lower-case SHA-256", async () => {
    const issuer = make();
    const first = await issuer.issue();
    const second = await issuer.issue();
    for (const issued of [first, second]) {
      expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(issued.sha256).toBe(await sha256Hex(issued.token));
    }
    expect(first.token).not.toBe(second.token);
  });
}
