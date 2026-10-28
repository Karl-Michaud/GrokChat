/** PublishPost and PartSender on stubs: the order of plan §3.3 #4 and the rows of §3.1.1. */
import { describe, expect, it } from "vitest";
import { postId } from "../../../../src/entities/identity/ids";
import { HOUR, MINUTE } from "../../../../src/entities/time/instant";
import type { XFailure } from "../../../../src/entities/x/x_failure";
import { InvocationBudgetMeter } from "../../../../src/frameworks/budget/invocation_meter";
import { ACCOUNT, aPolicy, aPost, part, sendingState, sentState, T0 } from "../../support/builders";
import { PartSender } from "../../../../src/use_cases/run_services/part_sender";
import { makeWorld } from "../../support/world";
import { http, meter, put, ready, required, states, stored } from "../../support/publishing";

describe("media is uploaded just before its part", () => {
  it("uploads each item and passes the X media ids to the create", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const a = await world.stage(ACCOUNT, "PHOTO", "m-a");
    const b = await world.stage(ACCOUNT, "PHOTO", "m-b");
    put(world, aPost({ parts: [part("pics", undefined, [a.id, b.id])] }));
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect([...world.x.posts.values()].map((post) => post.media)).toStrictEqual([["m-1", "m-2"]]);
    expect(world.costs.entries.map((entry) => [entry.operation, entry.estimate])).toStrictEqual([
      ["media_upload", { kind: "unknown" }],
      ["media_upload", { kind: "unknown" }],
      ["create", { kind: "usd", micros: 15_000 }],
    ]);
    expect(world.audit.events.map((event) => event.detail)).toStrictEqual([
      "uploaded",
      "uploaded",
      "sent x-3",
    ]);
    expect((await world.usage.current(T0)).classB).toBe(2);
  });

  it.each([
    ["missing media", null, "media_missing"],
    ["someone else's media", "acc-2", "media_missing"],
  ] as const)("%s: the part is REJECTED and the post FAILED", async (_name, owner, reason) => {
    const world = makeWorld();
    await world.seedAccount();
    const item = await world.stage(ACCOUNT, "PHOTO", "m-a");
    if (owner === null) {
      world.media.rows.clear();
    } else {
      await world.media.save({ ...item, ownerAccountId: owner as typeof ACCOUNT });
    }
    put(world, aPost({ parts: [part("pic", undefined, [item.id])] }));
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(stored(world)).toMatchObject({
      lifecycle: "DONE",
      parts: [{ state: { kind: "REJECTED", reason } }],
    });
  });

  it("blob gone, or R2 reads over quota: REJECTED with the reason", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const item = await world.stage(ACCOUNT, "PHOTO", "m-a");
    world.blobs.blobs.clear();
    put(world, aPost({ parts: [part("pic", undefined, [item.id])] }));
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(stored(world)?.parts[0]?.state).toStrictEqual({
      kind: "REJECTED",
      reason: "media_missing",
    });

    const quota = makeWorld();
    await quota.seedAccount();
    const other = await quota.stage(ACCOUNT, "PHOTO", "m-b");
    await quota.usage.record({ storedBytes: 0, classA: 0, classB: 8_000_000 }, T0);
    put(quota, aPost({ parts: [part("pic", undefined, [other.id])] }));
    await quota.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(stored(quota)?.parts[0]?.state).toStrictEqual({
      kind: "REJECTED",
      reason: "media_quota",
    });
  });

  it("an upload X refuses with 401: the account needs a reconnect and the post goes back", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const item = await world.stage(ACCOUNT, "PHOTO", "m-a");
    put(world, aPost({ parts: [part("pic", undefined, [item.id])] }));
    world.x.scripts.upload.push({ kind: "fail", failure: http(401) });
    await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("NEEDS_RECONNECT");
    expect(stored(world)).toMatchObject({
      lifecycle: "SCHEDULED",
      parts: [{ state: { kind: "PENDING" } }],
    });
    expect(world.audit.events.map((event) => event.detail)).toStrictEqual(["failed: http"]);
  });

  it("an upload rate-limited for the whole app: deferred, and the run reports it", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const item = await world.stage(ACCOUNT, "PHOTO", "m-a");
    put(world, aPost({ parts: [part("pic", undefined, [item.id])] }));
    world.x.scripts.upload.push({ kind: "fail", failure: http(429, "app", T0 + 5 * MINUTE) });
    const summary = await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(summary.appRateLimited).toBe(true);
    expect(stored(world)?.lifecycle).toBe("SCHEDULED");
  });
});

describe("the create's outcome (mapXOutcome → §3.1.1)", () => {
  async function outcome(failure: XFailure | "created_no_response", threadSent = false) {
    const world = makeWorld();
    await world.seedAccount();
    const parts = threadSent ? [part("a", sentState("x-0")), part("b")] : [part("a"), part("b")];
    const lifecycle = threadSent ? "RESUMING" : "SCHEDULED";
    put(world, aPost({ lifecycle, resumeAt: threadSent ? T0 : null, parts }));
    world.x.scripts.create.push(
      failure === "created_no_response"
        ? { kind: "created_no_response" }
        : { kind: "fail", failure },
    );
    const summary = await world.publishPost.publishDue(ACCOUNT, meter());
    return { world, summary, post: stored(world) };
  }

  it("not sent: the part is PENDING again and the post SCHEDULED; X billed nothing", async () => {
    const { post, world } = await outcome({ kind: "not_sent" });
    expect(post).toMatchObject({
      lifecycle: "SCHEDULED",
      parts: [{ state: { kind: "PENDING" } }, {}],
    });
    expect(world.costs.entries.map((entry) => entry.estimate)).toStrictEqual([
      { kind: "usd", micros: 0 },
    ]);
  });

  it("no response after X created it: UNKNOWN, DONE, billed, never re-sent", async () => {
    const { post, world } = await outcome("created_no_response");
    expect(post).toMatchObject({
      lifecycle: "DONE",
      parts: [{ state: { kind: "UNKNOWN", checks: 0 } }, {}],
    });
    expect(world.costs.entries.map((entry) => entry.estimate)).toStrictEqual([
      { kind: "usd", micros: 15_000 },
    ]);
    expect(world.audit.events.map((event) => event.detail)).toStrictEqual(["unknown"]);
    expect(world.x.posts.size).toBe(1);
  });

  it("a 5xx: UNKNOWN", async () => {
    const { post } = await outcome(http(503));
    expect(post?.parts[0]?.state.kind).toBe("UNKNOWN");
  });

  it("a 400 on the first part: FAILED", async () => {
    const { post } = await outcome(http(400));
    expect(post).toMatchObject({
      lifecycle: "DONE",
      parts: [{ state: { kind: "REJECTED", reason: "x_400: why" } }, {}],
    });
  });

  it("a 400 on a later part: PARTIALLY_PUBLISHED", async () => {
    const { post } = await outcome(http(400), true);
    expect(post).toMatchObject({
      lifecycle: "DONE",
      parts: [{ state: { kind: "SENT" } }, { state: { kind: "REJECTED" } }],
    });
  });

  it("a 401 from create: NEEDS_RECONNECT, the part back to PENDING, never FAILED", async () => {
    const { post, world } = await outcome(http(401));
    expect(post).toMatchObject({
      lifecycle: "SCHEDULED",
      parts: [{ state: { kind: "PENDING" } }, {}],
    });
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("NEEDS_RECONNECT");
  });

  it("a user 429 on a later part: RESUMING at X's retry time", async () => {
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
    world.x.scripts.create.push({ kind: "fail", failure: http(429, "user", T0 + 15 * MINUTE) });
    const summary = await world.publishPost.publishDue(ACCOUNT, meter());
    expect(summary.appRateLimited).toBe(false);
    expect(stored(world)).toMatchObject({ lifecycle: "RESUMING", resumeAt: T0 + 15 * MINUTE });
  });

  it("an app 429 stops the run: later due posts are left for the next tick", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(world, aPost({ id: postId("p-1"), publishAt: T0 - 2 }));
    put(world, aPost({ id: postId("p-2"), publishAt: T0 - 1 }));
    world.x.scripts.create.push({ kind: "fail", failure: http(429, "app") });
    const summary = await world.publishPost.publishDue(ACCOUNT, meter());
    expect(summary).toStrictEqual({
      ran: true,
      sent: 0,
      touched: [postId("p-1")],
      appRateLimited: true,
    });
    expect(stored(world, postId("p-2"))?.lifecycle).toBe("SCHEDULED");
  });

  it("a version conflict on the commit stops the post after the send", async () => {
    const world = makeWorld();
    await ready(world, { parts: [part("a"), part("b")] });
    world.writer.commitPart = () => Promise.resolve({ kind: "version_conflict" });
    const summary = await world.publishPost.publishNow(ACCOUNT, postId("post-1"), meter());
    expect(summary.sent).toBe(0);
    expect(states(world)).toStrictEqual(["SENDING", "PENDING"]);
    expect(world.x.posts.size).toBe(1);
  });
});

describe("publishDue: recovery, then every due post, oldest first", () => {
  it("recovers dead PUBLISHING posts under the lock (A3)", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
    put(
      world,
      aPost({
        id: postId("sending"),
        lifecycle: "PUBLISHING",
        parts: [part("a", sendingState(T0 - 9))],
      }),
    );
    put(
      world,
      aPost({
        id: postId("none"),
        lifecycle: "PUBLISHING",
        publishAt: T0 + HOUR,
        parts: [part("a")],
      }),
    );
    put(
      world,
      aPost({
        id: postId("some"),
        lifecycle: "PUBLISHING",
        parts: [part("a", sentState("x")), part("b")],
        publishAt: T0 + HOUR,
      }),
    );
    world.x.scripts.create.push({ kind: "fail", failure: { kind: "not_sent" } });
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect(stored(world, postId("sending"))).toMatchObject({
      lifecycle: "DONE",
      parts: [{ state: { kind: "UNKNOWN", attemptAt: T0 - 9 } }],
    });
    expect(stored(world, postId("none"))?.lifecycle).toBe("SCHEDULED");
    // Recovered to RESUMING at now, so due at once: its next create never left, so it waits a minute.
    expect(stored(world, postId("some"))).toMatchObject({
      lifecycle: "RESUMING",
      resumeAt: T0 + MINUTE,
      parts: [{ state: { kind: "SENT" } }, { state: { kind: "PENDING" } }],
    });
  });

  it("sends due posts oldest first, skips what is not due, and marks missed ones", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: 0, grace: 10 * MINUTE }) });
    put(world, aPost({ id: postId("later"), publishAt: T0 - MINUTE, parts: [part("later")] }));
    put(
      world,
      aPost({ id: postId("earlier"), publishAt: T0 - 2 * MINUTE, parts: [part("earlier")] }),
    );
    put(world, aPost({ id: postId("missed"), publishAt: T0 - HOUR, parts: [part("missed")] }));
    put(world, aPost({ id: postId("future"), publishAt: T0 + MINUTE }));
    put(world, aPost({ id: postId("resume-null"), lifecycle: "RESUMING", resumeAt: null }));
    const summary = await world.publishPost.publishDue(ACCOUNT, meter());
    expect(summary).toStrictEqual({
      ran: true,
      sent: 2,
      touched: [postId("missed"), postId("earlier"), postId("later")],
      appRateLimited: false,
    });
    expect([...world.x.posts.values()].map((post) => post.text)).toStrictEqual([
      "earlier",
      "later",
    ]);
    expect(stored(world, postId("missed"))?.lifecycle).toBe("MISSED");
    expect(stored(world, postId("future"))?.lifecycle).toBe("SCHEDULED");
  });

  it("a yield stops the run, and an unknown account does nothing", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(world, aPost({ id: postId("p-1"), publishAt: T0 - 2 }));
    put(world, aPost({ id: postId("p-2"), publishAt: T0 - 1 }));
    const oneTokenStep = new InvocationBudgetMeter({
      deadline: T0 + HOUR,
      cloudflareCalls: 2,
      externalSubrequests: 50,
    });
    const summary = await world.publishPost.publishDue(ACCOUNT, oneTokenStep);
    expect(summary.touched).toStrictEqual([postId("p-1")]);
    world.accounts.rows.clear();
    expect(await world.publishPost.publishDue(ACCOUNT, meter())).toStrictEqual({
      ran: true,
      sent: 0,
      touched: [],
      appRateLimited: false,
    });
  });

  it("a post someone else changed after it was listed is skipped", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(world, aPost({ publishAt: T0 - 1 }));
    const list = world.reader.list.bind(world.reader);
    world.reader.list = async (filter) => {
      const found = await list(filter);
      if (filter.dueBy !== undefined) {
        world.table.rows.set(postId("post-1"), { ...required(stored(world)), version: 99 });
      }
      return found;
    };
    const summary = await world.publishPost.publishDue(ACCOUNT, meter());
    expect(summary).toStrictEqual({ ran: true, sent: 0, touched: [], appRateLimited: false });
  });
});

describe("PartSender on a malformed PUBLISHING post", () => {
  it("every part already SENT: done, nothing sent", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const post = aPost({ lifecycle: "PUBLISHING", parts: [part("a", sentState("x"))] });
    expect(await world.sender.sendNext(post, meter())).toStrictEqual({
      post,
      sent: false,
      stop: "done",
      appRateLimited: false,
    });
  });

  it("a lost token for an account that no longer exists: deferred, nothing saved for it", async () => {
    const world = makeWorld();
    const post = aPost({ lifecycle: "PUBLISHING", parts: [part("a")] });
    put(world, post);
    const step = await world.sender.sendNext(post, meter());
    expect(step).toMatchObject({ stop: "deferred", sent: false, post: { lifecycle: "SCHEDULED" } });
    expect(world.accounts.rows.size).toBe(0);
  });

  it("a token provider that cannot fit a refresh makes the post yield", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const post = put(world, aPost({ lifecycle: "PUBLISHING", parts: [part("a")] }));
    const sender = new PartSender({
      reader: world.reader,
      ownPosts: world.reader,
      accounts: world.accounts,
      tokens: { accessToken: () => Promise.resolve({ kind: "refresh_does_not_fit" }) },
      publisher: world.xPublisher,
      stager: world.stager,
      recorder: world.recorder,
      steps: world.steps,
      clock: world.clock,
    });
    expect(await sender.sendNext(post, meter())).toMatchObject({
      stop: "yielded",
      post: { lifecycle: "SCHEDULED" },
    });
  });
});
