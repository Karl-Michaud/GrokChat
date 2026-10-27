/**
 * The account Durable Object's own behaviour: one account per object, every method's error
 * mapping, the Worker-side client, the production object before the X drivers exist, the
 * locks inside workerd, and the D1 calls a part costs (I9).
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { partCost } from "../../src/entities/budget/budget";
import { accountId, postId, xPostId, type AccountId } from "../../src/entities/identity/ids";
import { MINUTE, SECOND } from "../../src/entities/time/instant";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { AccountObjects } from "../../src/frameworks/durable_objects/account_client";
import { X_UNAVAILABLE } from "../../src/frameworks/durable_objects/x_unavailable";
import { ManualClock } from "../../src/frameworks/memory/manual_clock";
import { MemoryLocks, MemorySingleFlight } from "../../src/frameworks/memory/memory_locks";
import { aPost, anAccount, aPersonality, part, T0 } from "../unit/support/builders";
import { locksContract, singleFlightContract } from "../contract/coordination.contract";
import { freshStorage } from "./support/fresh_d1";
import { freshAccountId, newHarness, objectFor, seedAccount } from "./support/harness";

beforeEach(freshStorage);

const DEADLINE = T0 + 10 * SECOND;
const TOKENS = { accessToken: "a", refreshToken: "r", accessExpiresAt: T0 + 2 * 60 * MINUTE };

describe("one object, one account", () => {
  it("serves the first account it is called for, and refuses any other, even after a reset", async () => {
    newHarness();
    const account = await seedAccount();
    const object = objectFor(account.id);
    const other = accountId("someone-else");
    expect(await object.publishDue(other, T0, DEADLINE)).toStrictEqual({
      ran: false,
      sent: 0,
      touched: [],
      appRateLimited: false,
    });
    expect(await object.publishDue(account.id, T0, DEADLINE)).toMatchObject({ ran: true });
    const fresh = objectFor(freshAccountId());
    const bound = await runInDurableObject(fresh, async (instance, state) => {
      await state.storage.put("account", "acc-first");
      return instance.publishDue(accountId("acc-second"), T0, DEADLINE);
    });
    expect(bound.ran).toBe(false);
  });
});

describe("every method maps a failure to a result, so the object is never reset by a throw", () => {
  it("publish, reconcile, metrics, delete and token storage", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const object = objectFor(account.id);
    h.meter.broken = true;
    const id = account.id;
    expect((await object.publishNow(id, postId("p"), DEADLINE)).ran).toBe(false);
    expect(await object.reconcile(id, T0, DEADLINE)).toStrictEqual({
      ran: false,
      found: 0,
      notFound: 0,
    });
    expect(await object.collect(id, T0, DEADLINE)).toStrictEqual({ ran: false, read: 0 });
    h.x.scripts.delete.push({ kind: "ok" });
    expect(await object.deletePost(id, [xPostId("x-1")])).toStrictEqual([]);
    expect(await object.storeConnectedTokens(accountId("not-this"), TOKENS)).toStrictEqual({
      stored: false,
    });
    expect(h.builds).toBe(1);
  });
});

describe("the Worker-side client", () => {
  it("forwards each call to the account's object", async () => {
    const h = newHarness();
    const account = await seedAccount();
    await d1Stores(env.DB).writer.add(
      aPost({
        id: postId("p"),
        accountId: account.id,
        publishAt: T0 - MINUTE,
        parts: [part("hi")],
      }),
    );
    const objects = new AccountObjects(env.TEST_ACCOUNT);
    expect(await objects.publishNow(account.id, postId("p"), DEADLINE)).toMatchObject({ sent: 1 });
    expect(await objects.publishDue(account.id, T0, DEADLINE)).toMatchObject({
      ran: true,
      sent: 0,
    });
    expect(await objects.reconcile(account.id, T0, DEADLINE)).toStrictEqual({
      ran: true,
      found: 0,
      notFound: 0,
    });
    expect(await objects.collect(account.id, T0, DEADLINE)).toStrictEqual({ ran: true, read: 0 });
    const [sent] = [...h.x.posts.keys()];
    expect(await objects.deletePost(account.id, [sent ?? xPostId("")])).toStrictEqual([
      { xPostId: sent, deleted: true },
    ]);
    expect(h.x.posts.size).toBe(0);
  });

  it("a rejected call is no outcome, never retried; a connect that stored nothing fails loudly", async () => {
    newHarness();
    const failing = {
      idFromName: (name: string) => env.TEST_ACCOUNT.idFromName(name),
      get: () => ({
        publishDue: () => Promise.reject(new Error("reset")),
        publishNow: () => Promise.reject(new Error("reset")),
        reconcile: () => Promise.reject(new Error("reset")),
        collect: () => Promise.reject(new Error("reset")),
        deletePost: () => Promise.reject(new Error("reset")),
        storeConnectedTokens: () => Promise.resolve({ stored: false }),
      }),
    } as unknown as typeof env.TEST_ACCOUNT;
    const objects = new AccountObjects(failing);
    const id = accountId("a");
    expect((await objects.publishDue(id, T0, DEADLINE)).ran).toBe(false);
    expect((await objects.publishNow(id, postId("p"), DEADLINE)).ran).toBe(false);
    expect((await objects.reconcile(id, T0, DEADLINE)).ran).toBe(false);
    expect((await objects.collect(id, T0, DEADLINE)).ran).toBe(false);
    expect(await objects.deletePost(id, [xPostId("x")])).toStrictEqual([]);
    await expect(objects.storeConnectedTokens(id, TOKENS)).rejects.toThrow("were not stored");
  });
});

describe("the production object (main.ts) before the X drivers land", () => {
  it("stores tokens sealed, and sends nothing: a due post waits as a retryable failure", async () => {
    const account = anAccount({ id: accountId("acc-prod") });
    const stores = d1Stores(env.DB);
    await stores.accounts.save(account);
    await stores.personalities.save(aPersonality({ id: account.personalityId }));
    const objects = new AccountObjects(env.ACCOUNT);
    await objects.storeConnectedTokens(account.id, {
      ...TOKENS,
      accessExpiresAt: Date.now() + 2 * 60 * MINUTE,
    });
    await stores.writer.add(
      aPost({ id: postId("prod"), accountId: account.id, publishAt: Date.now() - MINUTE }),
    );
    const summary = await objects.publishNow(account.id, postId("prod"), Date.now() + 10 * SECOND);
    expect(summary).toMatchObject({ ran: true, sent: 0 });
    const post = await stores.reader.get(postId("prod"));
    expect(post?.lifecycle).toBe("SCHEDULED");
    expect(post?.parts[0]?.state.kind).toBe("PENDING");
  });
});

describe("X_UNAVAILABLE", () => {
  it("fails every call before a request would leave", async () => {
    const id = accountId("a");
    const notSent = { ok: false, failure: { kind: "not_sent" } };
    expect(await X_UNAVAILABLE.publisher.create(id, "t", [], null)).toStrictEqual(notSent);
    expect(await X_UNAVAILABLE.publisher.delete(id, xPostId("x"))).toStrictEqual(notSent);
    expect(await X_UNAVAILABLE.uploader.upload(id, new Uint8Array(), "PHOTO")).toStrictEqual(
      notSent,
    );
    expect(await X_UNAVAILABLE.timeline.recent(id, T0, 5)).toStrictEqual(notSent);
    expect(await X_UNAVAILABLE.metrics.read(id, [])).toStrictEqual(notSent);
    expect(await X_UNAVAILABLE.refresher.refresh("r")).toStrictEqual({ kind: "not_sent" });
  });
});

describe("the locks and single-flight the object uses, in workerd", () => {
  locksContract(() => {
    const clock = new ManualClock(T0);
    return {
      locks: new MemoryLocks(clock),
      advance: (ms) => {
        clock.advance(ms);
      },
    };
  });
  singleFlightContract(() => new MemorySingleFlight());
});

describe("I9: a part costs a fixed number of D1 calls, inside its worst case", () => {
  it("each further part of a thread adds the same calls, at most partCost's", async () => {
    const calls = async (parts: number, account: AccountId): Promise<number> => {
      const h = newHarness();
      await seedAccount({ id: account });
      await d1Stores(env.DB).writer.add(
        aPost({
          id: postId(`${account}-thread`),
          accountId: account,
          publishAt: T0 - MINUTE,
          parts: Array.from({ length: parts }, (_, index) => part(`part ${String(index)}`)),
        }),
      );
      h.meter.calls = 0;
      await objectFor(account).publishDue(account, T0, DEADLINE);
      expect(h.x.posts.size).toBe(parts);
      return h.meter.calls;
    };
    const one = await calls(1, freshAccountId());
    const two = await calls(2, freshAccountId());
    const three = await calls(3, freshAccountId());
    expect(three - two).toBe(two - one);
    expect(two - one).toBeLessThanOrEqual(partCost([]).cloudflareCalls);
  });
});
