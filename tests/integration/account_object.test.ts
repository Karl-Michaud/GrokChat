/**
 * The account Durable Object's own behaviour: one account per object, every method's error
 * mapping, the Worker-side client, the locks inside workerd, and the D1 calls a part costs (I9).
 * The production object on the X drivers is tests/integration/cron_ticks.test.ts.
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { partCost } from "../../src/entities/budget/budget";
import { accountId, postId, xPostId, type AccountId } from "../../src/entities/identity/ids";
import { MINUTE, SECOND } from "../../src/entities/time/instant";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { AccountObjects } from "../../src/frameworks/durable_objects/account_client";
import { SystemClock } from "../../src/frameworks/durable_objects/system_clock";
import { ManualClock } from "../../src/frameworks/memory/manual_clock";
import { MemoryLocks, MemorySingleFlight } from "../../src/frameworks/durable_objects/object_locks";
import { aPost, part, T0 } from "../unit/support/builders";
import {
  lockDeadlineContract,
  locksContract,
  singleFlightContract,
} from "../contract/coordination.contract";
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
    const racing = objectFor(freshAccountId());
    const [first, second] = await Promise.all([
      racing.publishDue(accountId("acc-a"), T0, DEADLINE),
      racing.publishDue(accountId("acc-b"), T0, DEADLINE),
    ]);
    expect([first.ran, second.ran]).toStrictEqual([true, false]);
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

describe("the locks and single-flight the object uses, in workerd", () => {
  locksContract(() => {
    const clock = new ManualClock(T0);
    return {
      locks: new MemoryLocks(clock, clock),
      advance: (ms) => {
        clock.advance(ms);
      },
    };
  });
  lockDeadlineContract(() => {
    const clock = new ManualClock(T0);
    return {
      locks: new MemoryLocks(clock, clock),
      now: () => clock.now(),
      advance: (ms) => {
        clock.advance(ms);
      },
    };
  });
  singleFlightContract(() => new MemorySingleFlight());
});

describe("the production locks (SystemClock, real timers) in workerd", () => {
  const clock = new SystemClock();
  lockDeadlineContract(() => ({
    locks: new MemoryLocks(clock, clock),
    now: () => clock.now(),
    advance: () => undefined,
  }));

  it("a deadline wait settles after its deadline on a real timer; a past one at once; cancel stops it", async () => {
    const past = clock.after(clock.now() - 1);
    past.cancel();
    await past.passed;
    const deadline = clock.now() + 20;
    await clock.after(deadline).passed;
    expect(clock.now()).toBeGreaterThan(deadline);
    let fired = false;
    const cancelled = clock.after(clock.now() + 10);
    void cancelled.passed.then(() => {
      fired = true;
    });
    cancelled.cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fired).toBe(false);
  });
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
