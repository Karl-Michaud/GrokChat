import { describe, expect, it } from "vitest";
import { invocationBudget } from "../../../../src/entities/budget/budget";
import { postId, xPostId } from "../../../../src/entities/identity/ids";
import type { Post } from "../../../../src/entities/posts/post";
import { DAY, HOUR, MINUTE } from "../../../../src/entities/time/instant";
import { MemoryBudgetMeter } from "../../../../src/frameworks/memory/memory_budget";
import type { PostReader } from "../../../../src/use_cases/ports/post_reader";
import { AccountRecovery } from "../../../../src/use_cases/run_services/account_recovery";
import { LOOKBACK, TIMELINE_PAGE } from "../../../../src/use_cases/run_services/reconcile_account";
import { METRICS_BATCH } from "../../../../src/use_cases/run_services/collect_account_metrics";
import { ACCOUNT, aMedia, aPost, part, sentState, T0, unknownState } from "../../support/builders";
import { makeWorld, type World } from "../../support/world";

const meterUntil = (deadline: number) => new MemoryBudgetMeter(invocationBudget(deadline));

const meter = (deadline = T0 + HOUR): MemoryBudgetMeter =>
  new MemoryBudgetMeter(invocationBudget(deadline));

function put(world: World, post: Post): Post {
  world.table.rows.set(post.id, post);
  return post;
}

describe("ReconcileAccount (plan §3.3 #6, R2)", () => {
  function unknownPost(world: World, text = "hello", extra: Partial<Post> = {}): Post {
    return put(
      world,
      aPost({ lifecycle: "DONE", parts: [part(text, unknownState(0, T0))], ...extra }),
    );
  }

  it("finds the post on X by normalised text: SENT, and the read is recorded", async () => {
    const world = makeWorld();
    await world.seedAccount();
    unknownPost(world, "a & b");
    const id = xPostId("x-on-x");
    world.x.posts.set(id, {
      id,
      account: ACCOUNT,
      text: " a &amp; b ",
      media: [],
      inReplyTo: null,
      createdAt: T0 + 1,
    });
    world.clock.advance(10 * MINUTE);
    expect(await world.reconcileAccount.reconcile(ACCOUNT, meter())).toStrictEqual({
      ran: true,
      found: 1,
      notFound: 0,
    });
    expect(world.table.rows.get(postId("post-1"))?.parts[0]?.state).toStrictEqual({
      kind: "SENT",
      xPostId: id,
      at: T0 + 10 * MINUTE,
    });
    expect(world.costs.entries).toStrictEqual([
      {
        at: T0 + 10 * MINUTE,
        accountId: ACCOUNT,
        operation: "read",
        estimate: { kind: "usd", micros: 5_000 },
      },
    ]);
    expect(world.audit.events.map((event) => event.detail)).toStrictEqual(["read 1"]);
  });

  it("looks back one minute before the attempt, at five posts", async () => {
    const world = makeWorld();
    await world.seedAccount();
    unknownPost(world);
    const calls: [number, number][] = [];
    world.timeline.recent = (_account, since, max) => {
      calls.push([since, max]);
      return Promise.resolve({ ok: true, value: [] });
    };
    await world.reconcileAccount.reconcile(ACCOUNT, meter());
    expect([LOOKBACK, TIMELINE_PAGE]).toStrictEqual([MINUTE, 5]);
    expect(calls).toStrictEqual([[T0 - MINUTE, 5]]);
  });

  it("not found twice → NOT_FOUND; a later part must reply to the part before", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(
      world,
      aPost({ lifecycle: "DONE", parts: [part("a", sentState("x-a")), part("b", unknownState())] }),
    );
    const wrong = xPostId("x-wrong");
    world.x.posts.set(wrong, {
      id: wrong,
      account: ACCOUNT,
      text: "b",
      media: [],
      inReplyTo: null,
      createdAt: T0,
    });
    expect(await world.reconcileAccount.reconcile(ACCOUNT, meter())).toStrictEqual({
      ran: true,
      found: 0,
      notFound: 1,
    });
    await world.reconcileAccount.reconcile(ACCOUNT, meter());
    expect(world.table.rows.get(postId("post-1"))?.parts[1]?.state).toStrictEqual({
      kind: "NOT_FOUND",
      attemptAt: T0,
    });
  });

  it("a thread part found as a reply resumes the rest of the thread", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(
      world,
      aPost({
        lifecycle: "DONE",
        parts: [part("a", sentState("x-a")), part("b", unknownState()), part("c")],
      }),
    );
    const id = xPostId("x-b");
    world.x.posts.set(id, {
      id,
      account: ACCOUNT,
      text: "b",
      media: [],
      inReplyTo: xPostId("x-a"),
      createdAt: T0,
    });
    await world.reconcileAccount.reconcile(ACCOUNT, meter());
    expect(world.table.rows.get(postId("post-1"))).toMatchObject({
      lifecycle: "RESUMING",
      resumeAt: T0,
    });
  });

  it("a timeline that cannot be read changes nothing and is checked again next time", async () => {
    const world = makeWorld();
    await world.seedAccount();
    unknownPost(world);
    world.x.scripts.timeline.push({ kind: "fail", failure: { kind: "no_response" } });
    expect(await world.reconcileAccount.reconcile(ACCOUNT, meter())).toStrictEqual({
      ran: true,
      found: 0,
      notFound: 0,
    });
    expect(world.table.rows.get(postId("post-1"))?.parts[0]?.state).toStrictEqual(
      unknownState(0, T0),
    );
    expect(world.costs.entries.map((entry) => entry.estimate)).toStrictEqual([
      { kind: "usd", micros: 0 },
    ]);
    expect(world.audit.events.map((event) => event.detail)).toStrictEqual(["failed: no_response"]);
  });

  it("stops when the budget runs out, skips a vanished account, and is single-flight (m2)", async () => {
    const world = makeWorld();
    await world.seedAccount();
    unknownPost(world);
    const empty = new MemoryBudgetMeter({
      deadline: T0 + HOUR,
      cloudflareCalls: 2,
      externalSubrequests: 1,
    });
    expect(await world.reconcileAccount.reconcile(ACCOUNT, empty)).toStrictEqual({
      ran: true,
      found: 0,
      notFound: 0,
    });
    const [first, second] = await Promise.all([
      world.reconcileAccount.reconcile(ACCOUNT, meter()),
      world.reconcileAccount.reconcile(ACCOUNT, meter()),
    ]);
    expect([first.ran, second.ran]).toStrictEqual([true, false]);
    world.accounts.rows.clear();
    expect(await world.reconcileAccount.reconcile(ACCOUNT, meter())).toStrictEqual({
      ran: true,
      found: 0,
      notFound: 0,
    });
  });

  it("a conflicting save is not counted", async () => {
    const world = makeWorld();
    await world.seedAccount();
    unknownPost(world);
    world.writer.save = () => Promise.resolve({ kind: "version_conflict" });
    expect(await world.reconcileAccount.reconcile(ACCOUNT, meter())).toStrictEqual({
      ran: true,
      found: 0,
      notFound: 0,
    });
  });
});

describe("CollectAccountMetrics (plan §3.3 #8)", () => {
  async function published(world: World, count: number, at = T0): Promise<void> {
    await world.seedAccount({ isAppOwner: true });
    for (let index = 0; index < count; index += 1) {
      const id = xPostId(`x-${String(index)}`);
      world.x.posts.set(id, {
        id,
        account: ACCOUNT,
        text: "t",
        media: [],
        inReplyTo: null,
        createdAt: at,
      });
      put(
        world,
        aPost({
          id: postId(`p-${String(index)}`),
          lifecycle: "DONE",
          parts: [part("t", sentState(id, at))],
        }),
      );
    }
  }

  it("reads only what is due, in batches of 100, and records owned-read costs", async () => {
    const world = makeWorld();
    await published(world, 150);
    world.clock.advance(HOUR);
    expect(METRICS_BATCH).toBe(100);
    expect(await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY))).toStrictEqual({
      ran: true,
      read: 150,
    });
    expect(world.metrics.snapshots).toHaveLength(150);
    expect(world.costs.entries.map((entry) => entry.estimate)).toStrictEqual([
      { kind: "usd", micros: 100_000 },
      { kind: "usd", micros: 50_000 },
    ]);
    expect(await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY))).toStrictEqual({
      ran: true,
      read: 0,
    });
  });

  it("only the sent parts of a partly published thread are read", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const id = xPostId("x-t");
    world.x.posts.set(id, {
      id,
      account: ACCOUNT,
      text: "t",
      media: [],
      inReplyTo: null,
      createdAt: T0,
    });
    put(
      world,
      aPost({
        lifecycle: "DONE",
        parts: [part("t", sentState(id)), part("u", { kind: "REJECTED", reason: "r" })],
      }),
    );
    world.clock.advance(HOUR);
    expect(await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY))).toStrictEqual({
      ran: true,
      read: 1,
    });
  });

  it("nothing before the first schedule point", async () => {
    const world = makeWorld();
    await published(world, 1);
    world.clock.advance(HOUR - 1);
    expect(await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY))).toStrictEqual({
      ran: true,
      read: 0,
    });
  });

  it("a failed read stores nothing and costs nothing", async () => {
    const world = makeWorld();
    await published(world, 1);
    world.clock.advance(HOUR);
    world.x.scripts.metrics.push({ kind: "fail", failure: { kind: "not_sent" } });
    expect(await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY))).toStrictEqual({
      ran: true,
      read: 0,
    });
    expect(world.costs.entries.map((entry) => entry.estimate)).toStrictEqual([
      { kind: "usd", micros: 0 },
    ]);
    expect(world.audit.events.map((event) => event.detail)).toStrictEqual(["failed: not_sent"]);
  });

  it("stops at the budget, skips a vanished account, and is single-flight", async () => {
    const world = makeWorld();
    await published(world, 1);
    world.clock.advance(HOUR);
    const empty = new MemoryBudgetMeter({
      deadline: T0 + DAY,
      cloudflareCalls: 2,
      externalSubrequests: 1,
    });
    expect(await world.collectMetrics.collect(ACCOUNT, empty)).toStrictEqual({
      ran: true,
      read: 0,
    });
    const both = await Promise.all([
      world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY)),
      world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY)),
    ]);
    expect(both.map((summary) => summary.ran)).toStrictEqual([true, false]);
    expect(both[0].read).toBe(1);
    world.accounts.rows.clear();
    expect(await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY))).toStrictEqual({
      ran: true,
      read: 0,
    });
  });
});

describe("AccountXGatewayService (A1)", () => {
  it("deletes in order, records each call, and stops at the first failure", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.x.scripts.delete.push({ kind: "ok" }, { kind: "fail", failure: { kind: "no_response" } });
    const out = await world.gateway.deletePost(ACCOUNT, [
      xPostId("x-3"),
      xPostId("x-2"),
      xPostId("x-1"),
    ]);
    expect(out).toStrictEqual([
      { xPostId: xPostId("x-3"), deleted: true },
      { xPostId: xPostId("x-2"), deleted: false },
    ]);
    expect(world.costs.entries.map((entry) => entry.estimate)).toStrictEqual([
      { kind: "usd", micros: 10_000 },
      { kind: "usd", micros: 0 },
    ]);
    expect(world.audit.events.map((event) => event.detail)).toStrictEqual([
      "deleted x-3",
      "failed: no_response",
    ]);
  });

  it("an unknown account is priced as an ordinary one", async () => {
    const world = makeWorld();
    await world.gateway.deletePost(ACCOUNT, [xPostId("x-1")]);
    expect(world.costs.entries.map((entry) => entry.estimate)).toStrictEqual([
      { kind: "usd", micros: 10_000 },
    ]);
  });

  it("stores connected tokens under the token lock and clears any marker", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await world.tokenStore.markRefreshing(ACCOUNT, T0);
    const tokens = { accessToken: "a9", refreshToken: "r9", accessExpiresAt: T0 + HOUR };
    await world.gateway.storeConnectedTokens(ACCOUNT, tokens);
    expect(await world.tokenStore.load(ACCOUNT)).toStrictEqual({ tokens, refreshingSince: null });
  });
});

describe("AccountRecovery, GuardedTransition and MediaCleanup", () => {
  it("recovery skips a post the reader returns that is not PUBLISHING, and counts conflicts out", async () => {
    const world = makeWorld();
    const odd = aPost({ lifecycle: "DONE" });
    const reader: PostReader = {
      get: (id) => world.reader.get(id),
      findByIdempotency: (bot, key) => world.reader.findByIdempotency(bot, key),
      list: () => Promise.resolve([odd]),
      recentActivity: (account, now) => (world.reader as PostReader).recentActivity(account, now),
      accountsNeedingWork: (now) => world.reader.accountsNeedingWork(now),
    };
    expect(await new AccountRecovery(reader, world.writer).recover(ACCOUNT, T0)).toBe(0);
    put(world, aPost({ lifecycle: "PUBLISHING" }));
    world.writer.save = () => Promise.resolve({ kind: "version_conflict" });
    expect(await world.recovery.recover(ACCOUNT, T0)).toBe(0);
  });

  it("GuardedTransition reports an invalid event and a stale version", async () => {
    const world = makeWorld();
    const post = put(world, aPost({ lifecycle: "SCHEDULED" }));
    expect(await world.steps.apply(post, { kind: "reject" })).toStrictEqual({
      kind: "invalid_transition",
    });
    const audit = { at: T0, actor: "a", action: "b", accountId: null, postId: null, detail: "" };
    const cost = {
      at: T0,
      accountId: ACCOUNT,
      operation: "create",
      estimate: { kind: "unknown" },
    } as const;
    expect(await world.steps.commit(post, { kind: "reject" }, audit, cost)).toStrictEqual({
      kind: "invalid_transition",
    });
    const stale = { ...post, version: 0 };
    expect(await world.steps.apply(stale, { kind: "cancel" })).toStrictEqual({
      kind: "version_conflict",
    });
  });

  it("MediaCleanup deletes media past retention, its bytes and its usage", async () => {
    const world = makeWorld();
    const kept = await world.stage(ACCOUNT, "PHOTO", "m-kept");
    const old = await world.stage(ACCOUNT, "PHOTO", "m-old");
    await world.usage.record({ storedBytes: kept.size + old.size, classA: 2, classB: 0 }, T0);
    put(world, aPost({ id: postId("waiting"), lifecycle: "SCHEDULED" }));
    await world.media.save({ ...kept, attachedTo: postId("waiting") });
    await world.media.save({
      ...aMedia({ id: old.id, storageKey: old.storageKey, size: old.size, stagedAt: T0 }),
    });
    world.clock.advance(2 * DAY);
    expect(await world.cleanup.run(meterUntil(world.clock.now() + HOUR))).toBe(1);
    expect([...world.media.rows.keys()]).toStrictEqual([kept.id]);
    expect(await world.blobs.get(old.storageKey)).toBeNull();
    expect((await world.usage.current(world.clock.now())).storedBytes).toBe(kept.size);
  });
});
