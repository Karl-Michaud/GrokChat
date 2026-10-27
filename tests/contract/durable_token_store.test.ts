/** The token vault and the Durable Object token store (plan §3.5, A1, A2), in workerd. */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { accountId, type AccountId } from "../../src/entities/identity/ids";
import { HOUR } from "../../src/entities/time/instant";
import type { TokenSet } from "../../src/entities/x/token_set";
import { TokenVault, TokenVaultError } from "../../src/frameworks/crypto/token_vault";
import { DurableTokenStore } from "../../src/frameworks/durable_objects/durable_token_store";
import type { TokenStore } from "../../src/use_cases/ports/token_store";
import { T0 } from "../unit/support/builders";
import { tokenStoreContract } from "./records.contract";

const key = (fill: number): string => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const KEY_A = key(1);
const KEY_B = key(2);
const TOKENS: TokenSet = {
  accessToken: "access-secret",
  refreshToken: "refresh-secret",
  accessExpiresAt: T0 + HOUR,
};

let objects = 0;

/** Each call runs inside one fresh Durable Object, against its own SQLite storage. */
function storeIn(name: string, vault: () => TokenVault): TokenStore {
  const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(name));
  const run = <T>(fn: (store: TokenStore, storage: DurableObjectStorage) => Promise<T>) =>
    runInDurableObject(stub, (_instance, state) =>
      fn(new DurableTokenStore(state.storage, vault()), state.storage),
    );
  return {
    load: (account) => run((store) => store.load(account)),
    markRefreshing: (account, at) => run((store) => store.markRefreshing(account, at)),
    commitRotated: (account, tokens) => run((store) => store.commitRotated(account, tokens)),
    clearMarker: (account) => run((store) => store.clearMarker(account)),
  };
}

function rawRecord(name: string, account: AccountId): Promise<unknown> {
  const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(name));
  return runInDurableObject(stub, (_instance, state) => state.storage.get(`tokens:${account}`));
}

describe("DurableTokenStore", () => {
  tokenStoreContract(() => {
    objects += 1;
    return storeIn(`token-contract-${String(objects)}`, () => TokenVault.fromSecret(KEY_A));
  });

  it("stores only ciphertext: no token appears in the Durable Object's storage", async () => {
    const account = accountId("acc-seal");
    await storeIn("seal", () => TokenVault.fromSecret(KEY_A)).commitRotated(account, TOKENS);
    const stored = JSON.stringify(await rawRecord("seal", account));
    expect(stored).not.toContain("access-secret");
    expect(stored).not.toContain("refresh-secret");
    expect(stored).toMatch(/"sealed":"v1\.[0-9a-f]{16}\./);
  });

  it("rotates: an older key still opens, the value is re-sealed under the newest, the old key can go", async () => {
    const account = accountId("acc-rotate");
    await storeIn("rotate", () => TokenVault.fromSecret(KEY_A)).commitRotated(account, TOKENS);
    await storeIn("rotate", () => TokenVault.fromSecret(KEY_A)).markRefreshing(account, T0);
    const before = JSON.stringify(await rawRecord("rotate", account));
    const both = storeIn("rotate", () => TokenVault.fromSecret(`${KEY_B}, ${KEY_A}`));
    expect(await both.load(account)).toStrictEqual({ tokens: TOKENS, refreshingSince: T0 });
    const after = JSON.stringify(await rawRecord("rotate", account));
    expect(after).not.toBe(before);
    expect(await storeIn("rotate", () => TokenVault.fromSecret(KEY_B)).load(account)).toStrictEqual(
      {
        tokens: TOKENS,
        refreshingSince: T0,
      },
    );
    await expect(
      storeIn("rotate", () => TokenVault.fromSecret(KEY_A)).load(account),
    ).rejects.toThrow("sealed under a key GROKCHAT_TOKEN_KEYS no longer holds");
  });

  it("a malformed stored token set fails closed", async () => {
    const vault = TokenVault.fromSecret(KEY_A);
    const account = accountId("acc-bad");
    const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName("bad"));
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put(`tokens:${account}`, {
        sealed: await vault.seal(JSON.stringify({ accessToken: 1 }), account),
        refreshingSince: null,
      });
    });
    await expect(storeIn("bad", () => vault).load(account)).rejects.toThrow("malformed");
  });
});

describe("TokenVault", () => {
  it("round-trips, with a fresh nonce each time, bound to its account", async () => {
    const vault = TokenVault.fromSecret(KEY_A);
    const one = await vault.seal("hello", "acc-1");
    const two = await vault.seal("hello", "acc-1");
    expect(one).not.toBe(two);
    expect(await vault.open(one, "acc-1")).toStrictEqual({ plaintext: "hello", current: true });
    await expect(vault.open(one, "acc-2")).rejects.toThrow("failed authentication");
    const [version, id, iv, body] = one.split(".");
    const flipped = `${version ?? ""}.${id ?? ""}.${iv ?? ""}.${(body ?? "").replace(/^./, (c) => (c === "A" ? "B" : "A"))}`;
    await expect(vault.open(flipped, "acc-1")).rejects.toThrow("failed authentication");
  });

  it("refuses malformed values and secrets, never echoing key material", async () => {
    const vault = TokenVault.fromSecret(KEY_A);
    for (const bad of ["", "v2.a.b.c", "v1.only"]) {
      await expect(vault.open(bad, "acc-1")).rejects.toThrow("not a sealed token value");
    }
    const cases: readonly [string, string][] = [
      ["", "holds no key"],
      [" , ", "holds no key"],
      ["%%%", "key 1 is not base64"],
      [`${KEY_A},${btoa("short")}`, "key 2 is not 32 bytes"],
      [`${KEY_A},${KEY_A}`, "lists a key twice"],
    ];
    for (const [secret, message] of cases) {
      expect(() => TokenVault.fromSecret(secret)).toThrow(message);
      try {
        TokenVault.fromSecret(secret);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(TokenVaultError);
        expect(String(error)).not.toContain(KEY_A);
      }
    }
  });

  it("the test binding's key is a valid secret", async () => {
    const vault = TokenVault.fromSecret(env.GROKCHAT_TOKEN_KEYS);
    expect((await vault.open(await vault.seal("x", "a"), "a")).plaintext).toBe("x");
  });
});
