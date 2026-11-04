/**
 * Tokens inside the real account Durable Object (plan §4): R3 the refresh race, with a negative
 * control; R18 lost tokens; R19 the publish → token lock order.
 */
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "../../src/entities/accounts/account";
import { TOKEN_REFRESH_MILLIS } from "../../src/entities/budget/budget";
import { postId, type AccountId, type PostId } from "../../src/entities/identity/ids";
import { HOUR, MINUTE, SECOND } from "../../src/entities/time/instant";
import { TokenVault } from "../../src/frameworks/crypto/token_vault";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { DurableTokenStore } from "../../src/frameworks/durable_objects/durable_token_store";
import type { AccessTokenResult } from "../../src/use_cases/ports/token_provider";
import type { StoredTokens } from "../../src/use_cases/ports/token_store";
import { aPost, part, T0 } from "../unit/support/builders";
import { freshStorage } from "./support/fresh_d1";
import { newHarness, objectFor, seedAccount, sleep, type Harness } from "./support/harness";

beforeEach(freshStorage);

const stores = () => d1Stores(env.DB);
/** Tokens are issued for two hours; this is past their expiry. */
const EXPIRED = T0 + 2 * HOUR + MINUTE;
/** A publishNow deadline a refresh fits in: its reserved 60 s timeout, then the send (plan §3.5). */
const REFRESH_FITS = EXPIRED + TOKEN_REFRESH_MILLIS + 10 * SECOND;

function storedTokens(account: AccountId): Promise<StoredTokens | null> {
  return runInDurableObject(objectFor(account), (_instance, state) =>
    new DurableTokenStore(state.storage, TokenVault.fromSecret(env.GROKCHAT_TOKEN_KEYS)).load(
      account,
    ),
  );
}

async function fiveConcurrentAccessTokens(locks: "mutex" | "none") {
  const h = newHarness({ locks });
  const account = await seedAccount();
  h.clock.set(EXPIRED);
  const results = await runInDurableObject(objectFor(account.id), (instance) =>
    Promise.all(
      Array.from({ length: 5 }, () =>
        instance.graph().tokens.accessToken(account.id, EXPIRED + HOUR),
      ),
    ),
  );
  return { h, account, results };
}

describe("R3: five concurrent accessToken calls with an expired token", () => {
  it("refresh once; every caller gets the rotated token, persisted before return", async () => {
    const { h, account, results } = await fiveConcurrentAccessTokens("mutex");
    expect(h.endpoint.calls).toStrictEqual(["refresh-1"]);
    const rotated: AccessTokenResult = { kind: "token", accessToken: "access-2" };
    expect(results).toStrictEqual(Array.from({ length: 5 }, () => rotated));
    expect(await storedTokens(account.id)).toMatchObject({
      tokens: { accessToken: "access-2", refreshToken: "refresh-2" },
      refreshingSince: null,
    });
  });

  it("negative control: without the token mutex, several refreshes and a stale-token failure", async () => {
    const { h, results } = await fiveConcurrentAccessTokens("none");
    expect(h.endpoint.calls.length).toBeGreaterThan(1);
    expect(results.some((result) => result.kind !== "token")).toBe(true);
  });
});

async function duePost(account: Account): Promise<PostId> {
  const id = postId(`${account.id}-post`);
  await stores().writer.add(
    aPost({ id, accountId: account.id, publishAt: EXPIRED - MINUTE, parts: [part("hello")] }),
  );
  return id;
}

async function expectRefusedWithNothingSending(h: Harness, account: Account, id: PostId) {
  expect((await stores().accounts.get(account.id))?.status).toBe("NEEDS_RECONNECT");
  const post = await stores().reader.get(id);
  expect(post?.lifecycle).toBe("SCHEDULED");
  expect(post?.parts.map((item) => item.state.kind)).toStrictEqual(["PENDING"]);
  expect(h.x.posts.size).toBe(0);
  const work = await stores().reader.accountsNeedingWork(EXPIRED + HOUR);
  expect(work.some((item) => item.reconcile)).toBe(false);
}

describe("R18: lost tokens", () => {
  it("the token response is lost after X rotated: NEEDS_RECONNECT, no part SENDING, never refreshed again", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const id = await duePost(account);
    h.clock.set(EXPIRED);
    h.endpoint.failNext = "lost_response";
    const object = objectFor(account.id);
    await object.publishNow(account.id, id, REFRESH_FITS);
    await expectRefusedWithNothingSending(h, account, id);
    h.clock.set(EXPIRED + 10 * MINUTE);
    await object.publishDue(account.id, EXPIRED + 10 * MINUTE, EXPIRED + 11 * MINUTE);
    await expectRefusedWithNothingSending(h, account, id);
    expect(h.endpoint.calls).toStrictEqual(["refresh-1"]);
    const reads = (await stores().audit.list({})).filter((event) => event.action === "x.read");
    expect(reads).toStrictEqual([]);
  });

  it("the object resets between the token call and the persist: the marker means NEEDS_RECONNECT", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const id = await duePost(account);
    h.clock.set(EXPIRED);
    const refresh = h.endpoint.refresh.bind(h.endpoint);
    const progress = { rotated: false };
    h.endpoint.refresh = async (token) => {
      const result = await refresh(token);
      progress.rotated = true;
      await sleep(100);
      return result;
    };
    const inFlight = objectFor(account.id)
      .publishNow(account.id, id, REFRESH_FITS)
      .catch((error: unknown) => error);
    while (!progress.rotated) {
      await sleep(1);
    }
    await abortAllDurableObjects();
    expect(await inFlight).toBeInstanceOf(Error);
    h.endpoint.refresh = refresh;
    await objectFor(account.id).publishNow(account.id, id, REFRESH_FITS);
    expect(h.builds).toBe(2);
    await expectRefusedWithNothingSending(h, account, id);
    expect(h.endpoint.calls).toStrictEqual(["refresh-1"]);
    expect((await storedTokens(account.id))?.refreshingSince).toBe(EXPIRED);
  });

  it("a refresh that does not fit the deadline yields without calling X", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const id = await duePost(account);
    h.clock.set(EXPIRED);
    await objectFor(account.id).publishNow(account.id, id, EXPIRED + SECOND);
    expect(h.endpoint.calls).toStrictEqual([]);
    const post = await stores().reader.get(id);
    expect(post).toMatchObject({ lifecycle: "SCHEDULED", resumeAt: EXPIRED });
    expect(h.x.posts.size).toBe(0);
  });

  it("a 401 from create marks the account NEEDS_RECONNECT; the post is refused, not FAILED", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const id = await duePost(account);
    h.clock.set(EXPIRED - MINUTE);
    h.x.scripts.create.push({
      kind: "fail",
      failure: { kind: "http", status: 401, detail: "Unauthorized", retryAt: null, scope: "user" },
    });
    await objectFor(account.id).publishNow(account.id, id, EXPIRED + 10 * SECOND);
    expect((await stores().accounts.get(account.id))?.status).toBe("NEEDS_RECONNECT");
    const post = await stores().reader.get(id);
    expect(post?.lifecycle).toBe("SCHEDULED");
    expect(post?.parts[0]?.state.kind).toBe("PENDING");
  });
});

describe("R19: the publish → token lock order", () => {
  it("an expired token during publishNow: one refresh, and the post is sent (no deadlock)", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const id = await duePost(account);
    h.clock.set(EXPIRED);
    const call = objectFor(account.id).publishNow(account.id, id, REFRESH_FITS);
    const outcome = await Promise.race([call, sleep(2_000).then(() => "deadlock" as const)]);
    expect(outcome).toMatchObject({ ran: true, sent: 1 });
    expect(h.endpoint.calls).toStrictEqual(["refresh-1"]);
    expect((await stores().reader.get(id))?.lifecycle).toBe("DONE");
  });
});
