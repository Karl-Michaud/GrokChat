/** Run-service details the mutation run showed were not yet pinned down. */
import { describe, expect, it } from "vitest";
import { accountId, postId, xPostId, xUserId } from "../../../../src/entities/identity/ids";
import { DAY, HOUR, MINUTE, SECOND } from "../../../../src/entities/time/instant";
import { MemoryBudgetMeter } from "../../../../src/frameworks/memory/memory_budget";
import {
  ACCOUNT,
  aPolicy,
  aPost,
  OTHER_ACCOUNT,
  part,
  sendingState,
  sentState,
  T0,
  unknownState,
} from "../../support/builders";
import { http, meter, put, ready, required, stored } from "../../support/publishing";
import { makeWorld } from "../../support/world";

describe("PartSender reports why it stopped", () => {
  it("sent → continue; retry → deferred; unknown and rejected → done", async () => {
    const cases = [
      [{ kind: "ok" }, "continue", true],
      [{ kind: "fail", failure: { kind: "not_sent" } }, "deferred", false],
      [{ kind: "fail", failure: { kind: "no_response" } }, "done", false],
      [{ kind: "fail", failure: http(400) }, "done", false],
    ] as const;
    for (const [script, stop, sent] of cases) {
      const world = makeWorld();
      await world.seedAccount();
      const post = put(world, aPost({ lifecycle: "PUBLISHING", parts: [part("a"), part("b")] }));
      world.x.scripts.create.push(script);
      expect(await world.sender.sendNext(post, meter())).toMatchObject({ stop, sent });
    }
  });

  it("media rejected → done, media to retry → deferred; the account stays ACTIVE", async () => {
    for (const [prepare, stop] of [
      ["missing", "done"],
      ["retry", "deferred"],
    ] as const) {
      const world = makeWorld();
      await world.seedAccount();
      const item = await world.stage(ACCOUNT, "PHOTO", "m-1");
      if (prepare === "missing") {
        world.media.rows.clear();
      } else {
        world.x.scripts.upload.push({ kind: "fail", failure: { kind: "not_sent" } });
      }
      const post = put(
        world,
        aPost({ lifecycle: "PUBLISHING", parts: [part("a", undefined, [item.id])] }),
      );
      expect(await world.sender.sendNext(post, meter())).toMatchObject({ stop });
      expect(required(await world.accounts.get(ACCOUNT)).status).toBe("ACTIVE");
    }
  });

  it("a conflict on SENDING → conflict, with the post as it was", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const post = put(world, aPost({ lifecycle: "PUBLISHING" }));
    world.writer.save = () => Promise.resolve({ kind: "version_conflict" });
    expect(await world.sender.sendNext(post, meter())).toStrictEqual({
      post,
      sent: false,
      stop: "conflict",
      appRateLimited: false,
    });
  });

  it("the token step's own time must fit, even when the part's would", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const post = put(world, aPost({ lifecycle: "PUBLISHING" }));
    expect(await world.sender.sendNext(post, meter(T0 + 3 * SECOND))).toMatchObject({
      stop: "yielded",
    });
    expect(world.x.posts.size).toBe(0);
  });

  it("an account gone mid-thread: the thread resumes a minute later", async () => {
    const world = makeWorld();
    const post = put(
      world,
      aPost({ lifecycle: "PUBLISHING", parts: [part("a", sentState("x")), part("b")] }),
    );
    await world.tokenStore.commitRotated(ACCOUNT, world.tokenEndpoint.issue());
    expect(await world.sender.sendNext(post, meter())).toMatchObject({
      stop: "deferred",
      post: { lifecycle: "RESUMING", resumeAt: T0 + MINUTE },
    });
  });
});

describe("PublishPost ordering and skips", () => {
  it("due order is by the due time, not publishAt: a RESUMING thread waits its turn", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
    put(
      world,
      aPost({
        id: postId("resume"),
        lifecycle: "RESUMING",
        publishAt: T0 - HOUR,
        resumeAt: T0 - 1,
        parts: [part("r0", sentState("x0")), part("r1")],
      }),
    );
    put(world, aPost({ id: postId("sched"), publishAt: T0 - 2, parts: [part("s")] }));
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect([...world.x.posts.values()].map((post) => post.text)).toStrictEqual(["s", "r1"]);
  });

  it("a post whose start conflicts is skipped and the next one still goes", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
    put(world, aPost({ id: postId("first"), publishAt: T0 - 2, parts: [part("first")] }));
    put(world, aPost({ id: postId("second"), publishAt: T0 - 1, parts: [part("second")] }));
    const save = world.writer.save.bind(world.writer);
    world.writer.save = (post, version, lifecycle) =>
      post.id === postId("first")
        ? Promise.resolve({ kind: "version_conflict" })
        : save(post, version, lifecycle);
    const summary = await world.publishPost.publishDue(ACCOUNT, meter());
    expect(summary).toStrictEqual({
      ran: true,
      sent: 1,
      touched: [postId("second")],
      appRateLimited: false,
    });
  });
});

describe("recovery, gateway, metrics and reconcile details", () => {
  it("recovery counts what it recovered and touches only this account", async () => {
    const world = makeWorld();
    put(
      world,
      aPost({ id: postId("a"), lifecycle: "PUBLISHING", parts: [part("a", sendingState())] }),
    );
    put(world, aPost({ id: postId("b"), lifecycle: "PUBLISHING" }));
    put(world, aPost({ id: postId("o"), accountId: OTHER_ACCOUNT, lifecycle: "PUBLISHING" }));
    expect(await world.recovery.recover(ACCOUNT, T0)).toBe(2);
    expect(stored(world, postId("o"))?.lifecycle).toBe("PUBLISHING");
  });

  it("a delete's cost is recorded against the account", async () => {
    const world = makeWorld();
    await world.gateway.deletePost(ACCOUNT, [xPostId("x")]);
    expect(world.costs.entries.map((entry) => [entry.accountId, entry.operation])).toStrictEqual([
      [ACCOUNT, "delete"],
    ]);
  });

  it("guarded commit reports a stale version", async () => {
    const world = makeWorld();
    const post = put(world, aPost({ lifecycle: "PUBLISHING", parts: [part("a", sendingState())] }));
    const audit = { at: T0, actor: "a", action: "b", accountId: null, postId: null, detail: "" };
    const cost = {
      at: T0,
      accountId: ACCOUNT,
      operation: "create",
      estimate: { kind: "unknown" },
    } as const;
    const stale = { ...post, version: 0 };
    expect(
      await world.steps.commit(stale, { kind: "unknown", part: 0 }, audit, cost),
    ).toStrictEqual({
      kind: "version_conflict",
    });
  });

  async function sentPosts(count: number, account = ACCOUNT, prefix = "p") {
    const world = makeWorld();
    await world.seedAccount();
    return {
      world,
      add: () => {
        addSent(world, count, account, prefix);
      },
    };
  }

  function addSent(
    world: ReturnType<typeof makeWorld>,
    count: number,
    account = ACCOUNT,
    prefix = "p",
  ): void {
    for (let index = 0; index < count; index += 1) {
      const id = xPostId(`${prefix}-x-${String(index)}`);
      world.x.posts.set(id, { id, account, text: "t", media: [], inReplyTo: null, createdAt: T0 });
      put(
        world,
        aPost({
          id: postId(`${prefix}-${String(index)}`),
          accountId: account,
          lifecycle: "DONE",
          parts: [part("t", sentState(id))],
        }),
      );
    }
  }

  it("metrics: exactly 100 due is one read; another account's posts are not read; the detail counts", async () => {
    const { world, add } = await sentPosts(100);
    add();
    addSent(world, 3, OTHER_ACCOUNT, "o");
    world.clock.advance(HOUR);
    expect(await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY))).toStrictEqual({
      ran: true,
      read: 100,
    });
    expect(world.audit.events.map((event) => event.detail)).toStrictEqual(["read 100"]);
  });

  it("metrics asks only for sent parts, and a vanished account with due posts reads nothing", async () => {
    const { world, add } = await sentPosts(1);
    add();
    put(
      world,
      aPost({
        id: postId("mixed"),
        lifecycle: "DONE",
        parts: [part("a", sentState("x-m")), part("b")],
      }),
    );
    const asked: (readonly string[])[] = [];
    const latest = world.metrics.latest.bind(world.metrics);
    world.metrics.latest = (ids) => {
      asked.push(ids);
      return latest(ids);
    };
    world.clock.advance(HOUR);
    world.accounts.rows.clear();
    expect(await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY))).toStrictEqual({
      ran: true,
      read: 0,
    });
    await world.seedAccount();
    await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY));
    expect(asked).toStrictEqual([["x-m", "p-x-0"]]);
  });

  it("metrics and reconcile are single-flight per account, not across accounts", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await world.seedAccount({ id: OTHER_ACCOUNT, xUserId: xUserId("x-user-2") });
    const both = await Promise.all([
      world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY)),
      world.collectMetrics.collect(OTHER_ACCOUNT, meter(T0 + DAY)),
      world.reconcileAccount.reconcile(ACCOUNT, meter()),
      world.reconcileAccount.reconcile(OTHER_ACCOUNT, meter()),
    ]);
    expect(both.map((summary) => summary.ran)).toStrictEqual([true, true, true, true]);
  });

  it("reconcile checks only UNKNOWN parts of this account, and text must match too", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(
      world,
      aPost({
        id: postId("t"),
        lifecycle: "DONE",
        parts: [part("a", sentState("x-a")), part("b", unknownState())],
      }),
    );
    put(
      world,
      aPost({
        id: postId("o"),
        accountId: OTHER_ACCOUNT,
        lifecycle: "DONE",
        parts: [part("o", unknownState())],
      }),
    );
    const id = xPostId("x-other-text");
    world.x.posts.set(id, {
      id,
      account: ACCOUNT,
      text: "not b",
      media: [],
      inReplyTo: xPostId("x-a"),
      createdAt: T0,
    });
    expect(await world.reconcileAccount.reconcile(ACCOUNT, meter())).toStrictEqual({
      ran: true,
      found: 0,
      notFound: 1,
    });
    expect(world.costs.entries).toHaveLength(1);
    expect(stored(world, postId("o"))?.parts[0]?.state).toStrictEqual(unknownState());
  });

  it("a refresh that keeps failing while the stored token keeps changing is retried once only", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.clock.advance(3 * HOUR);
    let next = 0;
    world.tokenEndpoint.refresh = async (token) => {
      world.tokenEndpoint.calls.push(token);
      next += 1;
      await world.tokenStore.commitRotated(ACCOUNT, {
        accessToken: "a",
        refreshToken: `rotated-${String(next)}`,
        accessExpiresAt: T0,
      });
      return { kind: "failed" };
    };
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "needs_reconnect",
    });
    expect(world.tokenEndpoint.calls).toStrictEqual(["refresh-1", "rotated-1"]);
  });

  it("an unknown account id is a no-op for the in-process stand-ins too", async () => {
    const world = makeWorld();
    const tight = new MemoryBudgetMeter({
      deadline: T0 + DAY,
      cloudflareCalls: 10,
      externalSubrequests: 1,
    });
    expect(await world.publishPost.publishDue(accountId("nobody"), tight)).toMatchObject({
      ran: true,
      sent: 0,
    });
  });
});

describe("the shared test helper", () => {
  it("ready() seeds a due post", async () => {
    const world = makeWorld();
    expect((await ready(world)).lifecycle).toBe("SCHEDULED");
  });

  it("cleanup never looks up a post for media that was never attached", async () => {
    const world = makeWorld();
    await world.stage(ACCOUNT, "PHOTO", "m-free");
    const asked: unknown[] = [];
    world.reader.get = (id) => {
      asked.push(id);
      return Promise.resolve(null);
    };
    await world.cleanup.run(T0);
    expect(asked).toStrictEqual([]);
  });
});
