/**
 * The cron ticks through `scheduled()` (src/main.ts), the production `AccountPublisher` Durable
 * Object and real local D1 and R2, on the real X fetch drivers with X stubbed at `fetch` (plan
 * §3.3 #5, #6, #8; §3.5; §6 integration): a scheduled post is published by the publish tick (so
 * the production object runs the X drivers), a token is refreshed with the X app's
 * credentials, an orphan is recovered (R20), an unknown outcome is reconciled and never re-sent
 * (R2), metrics are read and old staged media cleaned up, and reconcile and metrics run
 * single-flight per object.
 */
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Account } from "../../src/entities/accounts/account";
import {
  accountId,
  postId,
  stagedMediaId,
  xUserId,
  type AccountId,
  type PostId,
  xPostId,
} from "../../src/entities/identity/ids";
import type { Post } from "../../src/entities/posts/post";
import { DAY, HOUR, MINUTE } from "../../src/entities/time/instant";
import { CRONS } from "../../src/frameworks/cron/dispatch";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { AccountObjects } from "../../src/frameworks/durable_objects/account_client";
import { basicAuth } from "../../src/frameworks/x_auth/token_endpoint";
import worker from "../../src/main";
import { aMedia, aPolicy, anAccount, aPost, part, sentState } from "../unit/support/builders";
import { freshStorage } from "./support/fresh_d1";
import { sleep } from "./support/harness";
import { stubX, type XWire } from "./support/x_wire";

beforeEach(freshStorage);

let x: XWire;
beforeEach(() => {
  x = stubX();
});
afterEach(() => {
  x.restore();
});

const stores = () => d1Stores(env.DB);
const objects = () => new AccountObjects(env.ACCOUNT);

async function tick(cron: string): Promise<void> {
  await worker.scheduled(createScheduledController({ cron, scheduledTime: Date.now() }), env);
}

let seeded = 0;

/** An active, disclosed account in D1, with tokens sealed in its production object. */
async function seedAccount(accessExpiresAt = Date.now() + 2 * HOUR): Promise<Account> {
  seeded += 1;
  const n = String(seeded);
  const account = anAccount({
    id: accountId(`cron-acc-${n}`),
    xUserId: xUserId(`cron-x-${n}`),
    policy: aPolicy({ minGap: 0 }),
  });
  await stores().accounts.save(account);
  await objects().storeConnectedTokens(account.id, {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessExpiresAt,
  });
  return account;
}

async function addPost(account: AccountId, overrides: Partial<Post> = {}): Promise<PostId> {
  const id = postId(`${account}-post-${String(Math.random()).slice(2, 8)}`);
  await stores().writer.add(
    aPost({ id, accountId: account, publishAt: Date.now() - MINUTE, ...overrides }),
  );
  return id;
}

const get = async (id: PostId): Promise<Post | null> => stores().reader.get(id);

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100 && !(await check()); attempt += 1) {
    await sleep(10);
  }
}

describe("the publish tick (* * * * *) on the production object and the X drivers", () => {
  it("publishes a scheduled post through D1, the object and fetch, with the account's token", async () => {
    const account = await seedAccount();
    const id = await addPost(account.id, { parts: [part("hello from the cron")] });
    await tick(CRONS.publish);
    const post = await get(id);
    expect(post?.lifecycle).toBe("DONE");
    const state = post?.parts[0]?.state;
    expect(state?.kind).toBe("SENT");
    const [created] = [...x.emulator.posts.values()];
    expect(state).toMatchObject({ xPostId: created?.id });
    expect(created?.text).toBe("hello from the cron");
    expect(x.calls()).toStrictEqual(["POST /2/tweets"]);
    expect(x.seen[0]?.headers.get("authorization")).toBe("Bearer access-1");
    const audit = await stores().audit.list({ postId: id });
    expect(audit.map((event) => event.actor)).toContain("system:x");
  });

  it("refreshes a token near its expiry at X's token endpoint with the app's credentials, then sends with the new one", async () => {
    const account = await seedAccount(Date.now() + 5 * MINUTE);
    const id = await addPost(account.id);
    await tick(CRONS.publish);
    expect((await get(id))?.lifecycle).toBe("DONE");
    expect(x.calls()).toStrictEqual(["POST /2/oauth2/token", "POST /2/tweets"]);
    expect(x.seen[0]?.headers.get("authorization")).toBe(
      basicAuth({ clientId: "test-client-id", clientSecret: "test-client-secret" }),
    );
    expect(x.seen[0]?.body).toContain("refresh_token=refresh-1");
    expect(x.seen[1]?.headers.get("authorization")).toBe("Bearer access-2");
    // The refresh's own record is written after the rotated token is stored (A2, `waitUntil`).
    const refreshes = async () =>
      (await stores().audit.list({ accountId: account.id })).filter(
        (event) => event.action === "x.oauth",
      );
    await until(async () => (await refreshes()).length > 0);
    expect((await refreshes()).map((event) => event.detail)).toStrictEqual(["refresh rotated"]);
  });

  it("R20: recovers a post left PUBLISHING on an account with nothing else due, and sends it", async () => {
    const account = await seedAccount();
    const id = await addPost(account.id, { lifecycle: "PUBLISHING", version: 2 });
    await tick(CRONS.publish);
    expect((await get(id))?.lifecycle).toBe("DONE");
    expect(x.calls()).toStrictEqual(["POST /2/tweets"]);
  });

  it("dispatches nothing when no account has work", async () => {
    await seedAccount();
    await tick(CRONS.publish);
    expect(x.calls()).toStrictEqual([]);
  });
});

describe("R2: an unknown outcome is reconciled by the reconcile tick (*/10), never re-sent", () => {
  it("X created the post but the response was lost: UNKNOWN; the publish tick does not resend; reconcile finds it", async () => {
    const account = await seedAccount();
    const id = await addPost(account.id, { parts: [part("did it go out?")] });
    x.hook = (request) => Promise.resolve(request.method === "POST" ? "lose" : "answer");
    await tick(CRONS.publish);
    const unknown = await get(id);
    expect(unknown?.lifecycle).toBe("DONE");
    expect(unknown?.parts[0]?.state.kind).toBe("UNKNOWN");

    await tick(CRONS.publish);
    expect(await objects().publishDue(account.id, Date.now(), Date.now() + MINUTE)).toMatchObject({
      sent: 0,
    });
    expect(x.calls()).toStrictEqual(["POST /2/tweets"]);

    x.hook = () => Promise.resolve("answer");
    await tick(CRONS.reconcile);
    const found = await get(id);
    const [created] = [...x.emulator.posts.values()];
    expect(found?.parts[0]?.state).toMatchObject({ kind: "SENT", xPostId: created?.id });
    expect(x.calls()).toStrictEqual(["POST /2/tweets", `GET /2/users/${account.xUserId}/tweets`]);
  });
});

describe("the metrics tick (*/15): metrics per account, then the staged-media cleanup", () => {
  it("reads a sent post's metrics and deletes media staged days ago and never used", async () => {
    const account = await seedAccount();
    const xId = x.emulator.newId();
    x.emulator.posts.set(xId, {
      id: xId,
      text: "old",
      createdAt: Date.now() - DAY,
      inReplyTo: null,
    });
    await addPost(account.id, {
      lifecycle: "DONE",
      parts: [part("old", sentState(xId, Date.now() - DAY))],
    });
    const media = aMedia({
      id: stagedMediaId("cron-media"),
      ownerAccountId: account.id,
      storageKey: "cron-media-key",
      stagedAt: Date.now() - 3 * DAY,
    });
    await stores().media.save(media);
    await env.MEDIA.put(media.storageKey, new Uint8Array([1, 2, 3]));

    await tick(CRONS.metrics);
    expect(x.calls()).toStrictEqual(["GET /2/tweets"]);
    expect(x.seen[0]?.url.searchParams.get("ids")).toBe(xId);
    const snapshots = await stores().metrics.latest([xPostId(xId)]);
    expect(snapshots.map((snapshot) => snapshot.xPostId)).toStrictEqual([xPostId(xId)]);
    expect(await stores().media.get(media.id)).toBeNull();
    expect(await env.MEDIA.get(media.storageKey)).toBeNull();
  });
});

describe("reconcile and metrics are single-flight per account object (m2)", () => {
  it("a second reconcile or collect while one runs is skipped", async () => {
    const account = await seedAccount();
    const xId = x.emulator.newId();
    x.emulator.posts.set(xId, { id: xId, text: "m", createdAt: Date.now() - DAY, inReplyTo: null });
    await addPost(account.id, {
      lifecycle: "DONE",
      parts: [part("m", sentState(xId, Date.now() - DAY))],
    });
    await addPost(account.id, {
      lifecycle: "DONE",
      parts: [part("u", { kind: "UNKNOWN", attemptAt: Date.now() - MINUTE, checks: 0 })],
    });
    x.hook = async () => {
      await sleep(30);
      return "answer";
    };
    const deadline = Date.now() + 5 * MINUTE;
    const [first, second] = await Promise.all([
      objects().reconcile(account.id, Date.now(), deadline),
      objects().reconcile(account.id, Date.now(), deadline),
    ]);
    expect([first.ran, second.ran].sort()).toStrictEqual([false, true]);
    const [one, two] = await Promise.all([
      objects().collect(account.id, Date.now(), deadline),
      objects().collect(account.id, Date.now(), deadline),
    ]);
    expect([one.ran, two.ran].sort()).toStrictEqual([false, true]);
    expect(x.calls().filter((call) => call === "GET /2/tweets")).toHaveLength(1);
  });
});

describe("scheduled() with a schedule that is not one of the three", () => {
  it("rejects without touching D1, the objects or X", async () => {
    await expect(
      worker.scheduled(createScheduledController({ cron: "0 0 * * *" }), env),
    ).rejects.toThrow('no tick is scheduled as "0 0 * * *"');
    expect(x.calls()).toStrictEqual([]);
  });
});
