import { describe, expect, it } from "vitest";
import { FOLLOWER_READ_COST, TOKEN_REFRESH_MILLIS } from "../../../../src/entities/budget/budget";
import { accountId, xPostId, xUserId } from "../../../../src/entities/identity/ids";
import { DAY, HOUR, MINUTE } from "../../../../src/entities/time/instant";
import type { XFailure } from "../../../../src/entities/x/x_failure";
import { ImportPostsThenFollowers } from "../../../../src/use_cases/run_services/account_metrics_run";
import { ACCOUNT, OTHER_ACCOUNT, T0 } from "../../support/builders";
import { meter } from "../../support/publishing";
import { makeWorld, type World } from "../../support/world";

const snapshot = (world: World, deadline = world.clock.now() + HOUR) =>
  world.snapshotFollowers.snapshot(ACCOUNT, meter(deadline));

const userReads = (world: World) =>
  world.audit.events.filter((event) => event.action === "x.user_read");

describe("the daily follower snapshot (GROKCHAT-15)", () => {
  it("reads once per UTC day: claimed, recorded, metered and audited", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.xUsers.followers.set(ACCOUNT, 321);
    expect(await snapshot(world)).toBe(true);
    expect(await snapshot(world)).toBe(false);
    world.clock.advance(6 * HOUR);
    expect(await snapshot(world)).toBe(false);
    expect(world.xUsers.reads).toStrictEqual([ACCOUNT]);
    expect(world.followers.rows.get(`${ACCOUNT}|2026-10-27`)).toStrictEqual({
      claimedAt: T0,
      snapshot: {
        accountId: ACCOUNT,
        day: "2026-10-27",
        takenAt: T0,
        followers: 321,
        following: 5,
        posts: 12,
        listed: 1,
      },
    });
    expect(world.costs.entries).toStrictEqual([
      {
        at: T0,
        accountId: ACCOUNT,
        operation: "user_read",
        estimate: { kind: "usd", micros: 10_000 },
      },
    ]);
    expect(userReads(world).map((event) => [event.actor, event.detail])).toStrictEqual([
      ["system:x", "followers 321"],
    ]);
  });

  it("reads again on the next UTC day", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expect(await snapshot(world)).toBe(true);
    world.clock.advance(DAY);
    await world.seedAccount();
    expect(await snapshot(world)).toBe(true);
    expect(world.xUsers.reads).toHaveLength(2);
    expect([...world.followers.rows.keys()]).toStrictEqual([
      `${ACCOUNT}|2026-10-27`,
      `${ACCOUNT}|2026-10-28`,
    ]);
  });

  it("reads a PAUSED account; never an unknown, lost or disconnected one", async () => {
    const world = makeWorld();
    await world.seedAccount({ status: "PAUSED" });
    expect(await snapshot(world)).toBe(true);
    for (const status of ["NEEDS_RECONNECT", "DISCONNECTED"] as const) {
      const other = makeWorld();
      await other.seedAccount({ status });
      expect(await snapshot(other)).toBe(false);
      expect(other.followers.rows.size).toBe(0);
    }
    const empty = makeWorld();
    expect(await snapshot(empty)).toBe(false);
    expect(empty.xUsers.reads).toStrictEqual([]);
  });

  it("claims nothing when the read does not fit the meter", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expect(await snapshot(world, world.clock.now() + FOLLOWER_READ_COST.millis - 1)).toBe(false);
    expect(world.followers.rows.size).toBe(0);
    expect(await snapshot(world, world.clock.now() + FOLLOWER_READ_COST.millis)).toBe(true);
  });

  it("gives the day back when the token step stops it before X, and reads on a later tick", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.clock.advance(2 * HOUR - 5 * MINUTE);
    const short = world.clock.now() + TOKEN_REFRESH_MILLIS - 1;
    expect(await snapshot(world, short)).toBe(false);
    expect(world.followers.rows.size).toBe(0);
    expect(world.xUsers.reads).toStrictEqual([]);
    expect(await snapshot(world, world.clock.now() + TOKEN_REFRESH_MILLIS + HOUR)).toBe(true);
  });

  it.each<[XFailure, boolean]>([
    [{ kind: "not_sent" }, true],
    [{ kind: "no_token" }, true],
    [{ kind: "no_response" }, false],
    [{ kind: "http", status: 503, detail: "busy", retryAt: null, scope: "user" }, false],
  ])("after a failed read (%j), the day is free again: %s", async (failure, freed) => {
    const world = makeWorld();
    await world.seedAccount();
    world.x.scripts.users.push({ kind: "fail", failure });
    expect(await snapshot(world)).toBe(false);
    expect(world.followers.rows.size).toBe(freed ? 0 : 1);
    expect(world.costs.entries.map((entry) => entry.estimate)).toStrictEqual([
      { kind: "usd", micros: 0 },
    ]);
    expect(userReads(world).map((event) => event.detail)).toStrictEqual([
      `failed: ${failure.kind}`,
    ]);
    expect(await snapshot(world)).toBe(freed);
  });

  it("is single-flight per account: a concurrent run reads nothing, another account reads", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await world.seedAccount({ id: OTHER_ACCOUNT, xUserId: xUserId("x-user-2") });
    const other = world.snapshotFollowers.snapshot(OTHER_ACCOUNT, meter());
    const [first, second, third] = await Promise.all([snapshot(world), snapshot(world), other]);
    expect([first, second, third]).toStrictEqual([true, false, true]);
    expect([...world.xUsers.reads].sort()).toStrictEqual([ACCOUNT, OTHER_ACCOUNT]);
  });

  it("budgets the claim, the read, its records and the store: 4 calls, 1 fetch, 2 s", () => {
    expect(FOLLOWER_READ_COST).toStrictEqual({
      cloudflareCalls: 4,
      externalSubrequests: 1,
      millis: 2_000,
    });
  });

  it("the metrics run imports, reads the posts, then the followers", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.x.posts.set(xPostId("x-own"), {
      id: xPostId("x-own"),
      account: ACCOUNT,
      text: "from the X app",
      media: [],
      inReplyTo: null,
      createdAt: world.clock.now() - 2 * DAY,
    });
    const run = new ImportPostsThenFollowers(
      world.importPosts,
      world.collectMetrics,
      world.snapshotFollowers,
    );
    expect(await run.collect(ACCOUNT, meter())).toStrictEqual({
      ran: true,
      imported: 1,
      read: 1,
      followers: 1,
    });
    expect(await run.collect(ACCOUNT, meter())).toStrictEqual({
      ran: true,
      imported: 0,
      read: 0,
      followers: 0,
    });
    expect(await run.collect(accountId("nobody"), meter())).toStrictEqual({
      ran: true,
      imported: 0,
      read: 0,
      followers: 0,
    });
  });
});
