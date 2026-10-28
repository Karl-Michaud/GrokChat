/**
 * PartSender on replies (GROKCHAT-17, incident 2026-10-28): a reply X refuses never disconnects
 * the account, and a stored reply to a post that is not the account's own is never sent.
 */
import { describe, expect, it } from "vitest";
import { xPostId } from "../../../../src/entities/identity/ids";
import { derivedStatus } from "../../../../src/entities/posts/derived_status";
import type { XFailure } from "../../../../src/entities/x/x_failure";
import { ACCOUNT, anOwnPublishedPost, aPost, part, sentState, T0 } from "../../support/builders";
import { meter, put, required, stored } from "../../support/publishing";
import { makeWorld, type World } from "../../support/world";

const OWN = "1850000000000000001";
const FOREIGN = "1850000000000000009";
const REAL_DETAIL =
  "Forbidden: You are not permitted to perform this action. Reply to this conversation is not allowed";

const forbidden = (detail = REAL_DETAIL): XFailure => ({
  kind: "http",
  status: 403,
  detail,
  retryAt: null,
  scope: "user",
});

async function setUp(post: Parameters<typeof aPost>[0]): Promise<World> {
  const world = makeWorld();
  await world.seedAccount();
  put(world, anOwnPublishedPost(OWN));
  put(world, aPost({ lifecycle: "SCHEDULED", publishAt: T0, ...post }));
  return world;
}

const createAudits = (world: World): readonly string[] =>
  world.audit.events.filter((event) => event.action === "x.create").map((event) => event.detail);

describe("a 403 on a reply create", () => {
  it("leaves the post FAILED as reply_refused and the account ACTIVE, with X's wording audited", async () => {
    const world = await setUp({ replyTo: xPostId(OWN) });
    world.x.scripts.create.push({ kind: "fail", failure: forbidden() });
    await world.publishPost.publishDue(ACCOUNT, meter());
    const post = required(stored(world));
    expect(derivedStatus(post)).toBe("FAILED");
    expect(post.parts[0]?.state).toStrictEqual({ kind: "REJECTED", reason: "reply_refused" });
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("ACTIVE");
    expect(createAudits(world)).toStrictEqual([`reply_refused: x_403: ${REAL_DETAIL}`]);
  });

  it("is not retried: a later tick sends nothing more", async () => {
    const world = await setUp({ replyTo: xPostId(OWN) });
    world.x.scripts.create.push({ kind: "fail", failure: forbidden() });
    await world.publishPost.publishDue(ACCOUNT, meter());
    world.clock.advance(24 * 60 * 60 * 1000);
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect(createAudits(world)).toHaveLength(1);
    expect(world.x.posts.size).toBe(0);
  });

  it("on a thread's later part (a reply to its own part 1) is refused the same way", async () => {
    const world = await setUp({
      lifecycle: "RESUMING",
      resumeAt: T0,
      parts: [part("a", sentState("x-0")), part("b")],
    });
    world.x.scripts.create.push({ kind: "fail", failure: forbidden("Forbidden") });
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect(stored(world)?.parts[1]?.state).toStrictEqual({
      kind: "REJECTED",
      reason: "reply_refused",
    });
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("ACTIVE");
  });
});

describe("a 403 on an original post is unchanged", () => {
  it("the account needs a reconnect and the part goes back; X's wording is audited", async () => {
    const world = await setUp({});
    world.x.scripts.create.push({ kind: "fail", failure: forbidden("Forbidden") });
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("NEEDS_RECONNECT");
    expect(stored(world)?.parts[0]?.state.kind).toBe("PENDING");
    expect(createAudits(world)).toStrictEqual(["needs_reconnect: x_403: Forbidden"]);
  });
});

describe("a stored reply to a post that is not the account's own", () => {
  it("is never sent: REJECTED as reply_target_not_own, the account ACTIVE, X not called", async () => {
    const world = await setUp({ replyTo: xPostId(FOREIGN) });
    await world.publishPost.publishDue(ACCOUNT, meter());
    const post = required(stored(world));
    expect(derivedStatus(post)).toBe("FAILED");
    expect(post.parts[0]?.state).toStrictEqual({
      kind: "REJECTED",
      reason: "reply_target_not_own",
    });
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("ACTIVE");
    expect(createAudits(world)).toStrictEqual([]);
    expect(world.x.posts.size).toBe(0);
  });

  it("an own post of another account is not own either", async () => {
    const world = await setUp({ replyTo: xPostId("1850000000000000002") });
    put(world, anOwnPublishedPost("1850000000000000002", { accountId: "acc-2" as typeof ACCOUNT }));
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect(stored(world)?.parts[0]?.state).toMatchObject({ reason: "reply_target_not_own" });
  });

  it("a thread stored before the rule, its part 1 already sent, sends the rest under its own part", async () => {
    const world = await setUp({
      lifecycle: "RESUMING",
      resumeAt: T0,
      replyTo: xPostId(FOREIGN),
      parts: [part("a", sentState("x-0")), part("b")],
    });
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect([...world.x.posts.values()].map((post) => post.inReplyTo)).toStrictEqual([
      xPostId("x-0"),
    ]);
  });

  it("a reply to an own post is sent as a reply to it", async () => {
    const world = await setUp({ replyTo: xPostId(OWN) });
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect([...world.x.posts.values()].map((post) => post.inReplyTo)).toStrictEqual([xPostId(OWN)]);
    expect(derivedStatus(required(stored(world)))).toBe("PUBLISHED");
  });
});
