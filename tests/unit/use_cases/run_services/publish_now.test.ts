/** PublishPost and PartSender on stubs: the order of plan §3.3 #4 and the rows of §3.1.1. */
import { describe, expect, it } from "vitest";
import { postId, xPostId } from "../../../../src/entities/identity/ids";
import type { Post } from "../../../../src/entities/posts/post";
import { HOUR, MINUTE, SECOND } from "../../../../src/entities/time/instant";
import { MemoryBudgetMeter } from "../../../../src/frameworks/memory/memory_budget";
import { ACCOUNT, aPolicy, aPost, part, sentState, T0 } from "../../support/builders";
import { makeWorld } from "../../support/world";
import { meter, put, ready, required, states, stored } from "../../support/publishing";

describe("publishNow: the happy path", () => {
  it("sends every part, writes SENT with the X id, and the post is DONE", async () => {
    const world = makeWorld();
    await ready(world, { parts: [part("a"), part("b")] });
    const summary = await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(summary).toStrictEqual({
      ran: true,
      sent: 2,
      touched: [postId("post-1")],
      appRateLimited: false,
    });
    expect(stored(world)).toMatchObject({
      lifecycle: "DONE",
      version: 6,
      parts: [
        { state: { kind: "SENT", xPostId: xPostId("x-1"), at: T0 } },
        { state: { kind: "SENT", xPostId: xPostId("x-2"), at: T0 } },
      ],
    });
  });

  it("each create writes its audit event and cost entry in the commit", async () => {
    const world = makeWorld();
    await ready(world, { parts: [part("see https://a.co")] });
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(world.audit.events).toStrictEqual([
      {
        at: T0,
        actor: "system:x",
        action: "x.create",
        accountId: ACCOUNT,
        postId: postId("post-1"),
        detail: "sent x-1",
      },
    ]);
    expect(world.costs.entries).toStrictEqual([
      {
        at: T0,
        accountId: ACCOUNT,
        operation: "create",
        estimate: { kind: "usd", micros: 200_000 },
      },
    ]);
  });

  it("SENDING is written before the create reaches X (R4)", async () => {
    const world = makeWorld();
    await ready(world);
    const seen: (readonly string[])[] = [];
    world.x.beforeCreate = () => {
      seen.push(states(world));
      return Promise.resolve();
    };
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(seen).toStrictEqual([["SENDING"]]);
  });

  it("does nothing for a post of another account, an unknown post, or one not yet due", async () => {
    const world = makeWorld();
    await ready(world, { publishAt: T0 + MINUTE });
    const none = { ran: true, sent: 0, touched: [], appRateLimited: false };
    expect(await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter())).toStrictEqual(
      none,
    );
    expect(await world.publishPost.publishNow(ACCOUNT, postId("nope"), meter())).toStrictEqual(
      none,
    );
    put(world, aPost({ id: postId("other"), accountId: "acc-2" as Post["accountId"] }));
    expect(await world.publishPost.publishNow(ACCOUNT, postId("other"), meter())).toStrictEqual(
      none,
    );
    world.accounts.rows.clear();
    world.clock.advance(MINUTE);
    expect(await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter())).toStrictEqual(
      none,
    );
  });

  it("could not get the publish lock before the deadline: nothing changes", async () => {
    const world = makeWorld();
    await ready(world);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = world.locks.publish.run(() => gate, null);
    const waiting = world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter(T0 + SECOND));
    world.clock.advance(2 * SECOND);
    release();
    await held;
    expect(await waiting).toStrictEqual({
      ran: false,
      sent: 0,
      touched: [],
      appRateLimited: false,
    });
    expect(stored(world)?.lifecycle).toBe("SCHEDULED");
  });
});

describe("the token step comes first (N1)", () => {
  it("no tokens: the account needs a reconnect, the post goes back, no part is SENDING", async () => {
    const world = makeWorld();
    await ready(world);
    world.tokenStore.rows.clear();
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("NEEDS_RECONNECT");
    expect(stored(world)).toMatchObject({
      lifecycle: "SCHEDULED",
      parts: [{ state: { kind: "PENDING" } }],
    });
    expect(world.x.posts.size).toBe(0);
  });

  it("an expiring token is refreshed once and the post is sent (R19)", async () => {
    const world = makeWorld();
    await ready(world);
    world.clock.advance(2 * HOUR - 5 * MINUTE);
    world.table.rows.set(postId("post-1"), {
      ...required(stored(world)),
      publishAt: world.clock.now(),
    });
    await world.publishPost.publishNow(
      ACCOUNT,
      postId("post-1"),
      meter(world.clock.now() + 10 * SECOND),
    );
    expect(world.tokenEndpoint.calls).toStrictEqual(["refresh-1"]);
    expect(stored(world)?.lifecycle).toBe("DONE");
  });

  it("a refresh that does not fit the deadline yields before calling X (R18)", async () => {
    const world = makeWorld();
    await ready(world);
    world.clock.advance(2 * HOUR - 5 * MINUTE);
    world.table.rows.set(postId("post-1"), {
      ...required(stored(world)),
      publishAt: world.clock.now(),
    });
    const summary = await world.publishPost.publishNow(
      ACCOUNT,
      postId("post-1"),
      meter(world.clock.now() + 4 * SECOND),
    );
    expect(summary.sent).toBe(0);
    expect(world.tokenEndpoint.calls).toStrictEqual([]);
    expect(stored(world)?.lifecycle).toBe("SCHEDULED");
  });

  it("a refresh that never left: deferred a minute, the account stays ACTIVE", async () => {
    const world = makeWorld();
    await ready(world, { parts: [part("a"), part("b")] });
    world.clock.advance(2 * HOUR - 5 * MINUTE);
    const now = world.clock.now();
    put(
      world,
      aPost({
        lifecycle: "RESUMING",
        resumeAt: now,
        parts: [part("a", sentState("x-0")), part("b")],
      }),
    );
    world.tokenEndpoint.failNext = "not_sent";
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter(now + HOUR));
    expect(stored(world)).toMatchObject({ lifecycle: "RESUMING", resumeAt: now + MINUTE });
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("ACTIVE");
  });

  it("a later part after a lost token: RESUMING a minute later, as a gate refusal", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.tokenStore.rows.clear();
    put(
      world,
      aPost({
        lifecycle: "RESUMING",
        resumeAt: T0,
        parts: [part("a", sentState("x-0")), part("b")],
      }),
    );
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect(stored(world)).toMatchObject({ lifecycle: "RESUMING", resumeAt: T0 + MINUTE });
  });
});

describe("the budget is reserved before each part (A4)", () => {
  it("not enough for the token step: the post yields", async () => {
    const world = makeWorld();
    await ready(world);
    const tight = new MemoryBudgetMeter({
      deadline: T0 + HOUR,
      cloudflareCalls: 1,
      externalSubrequests: 50,
    });
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), tight);
    expect(stored(world)?.lifecycle).toBe("SCHEDULED");
    expect(world.x.posts.size).toBe(0);
  });

  it("not enough for the part's worst case: the post yields, and a thread resumes later", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(
      world,
      aPost({
        lifecycle: "RESUMING",
        resumeAt: T0,
        parts: [part("a", sentState("x-0")), part("b")],
      }),
    );
    const tight = new MemoryBudgetMeter({
      deadline: T0 + HOUR,
      cloudflareCalls: 4,
      externalSubrequests: 50,
    });
    await world.publishPost.publishDue(ACCOUNT, tight);
    expect(stored(world)).toMatchObject({ lifecycle: "RESUMING", resumeAt: T0 });
    expect(world.x.posts.size).toBe(0);
  });
});

describe("ReservePart: the gate under the lock", () => {
  it("a first part refused by the gate goes back to SCHEDULED", async () => {
    const world = makeWorld();
    await ready(world);
    await world.accounts.save({
      ...required(await world.accounts.get(ACCOUNT)),
      status: "PAUSED",
    });
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(stored(world)).toMatchObject({ lifecycle: "SCHEDULED", resumeAt: null });
  });

  it("a later part refused by the gate resumes when the gate next allows it", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: HOUR }) });
    put(
      world,
      aPost({
        id: postId("other"),
        lifecycle: "DONE",
        parts: [part("o", sentState("x-o", T0 - 10 * MINUTE))],
      }),
    );
    put(
      world,
      aPost({
        lifecycle: "RESUMING",
        resumeAt: T0,
        parts: [part("a", sentState("x-0")), part("b")],
      }),
    );
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect(stored(world)).toMatchObject({ lifecycle: "RESUMING", resumeAt: T0 + 50 * MINUTE });
  });

  it("an account that disappeared mid-run: deferred a minute", async () => {
    const world = makeWorld();
    await ready(world, { parts: [part("a"), part("b")] });
    const accounts = world.accounts;
    let reads = 0;
    const original = accounts.get.bind(accounts);
    accounts.get = (id) => {
      reads += 1;
      return reads >= 2 ? Promise.resolve(null) : original(id);
    };
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(stored(world)).toMatchObject({ lifecycle: "SCHEDULED" });
    expect(world.x.posts.size).toBe(0);
  });

  it("a version conflict on SENDING stops the post: nothing is sent", async () => {
    const world = makeWorld();
    await ready(world);
    const save = world.writer.save.bind(world.writer);
    world.writer.save = (post, version, lifecycle) =>
      post.parts.some((p) => p.state.kind === "SENDING")
        ? Promise.resolve({ kind: "version_conflict" })
        : save(post, version, lifecycle);
    const summary = await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(summary).toStrictEqual({
      ran: true,
      sent: 0,
      touched: [postId("post-1")],
      appRateLimited: false,
    });
    expect(world.x.posts.size).toBe(0);
    expect(stored(world)?.lifecycle).toBe("PUBLISHING");
  });
});
