import { describe, expect, it } from "vitest";
import { IMPORT_PAGE_COST, TOKEN_REFRESH_MILLIS } from "../../../../src/entities/budget/budget";
import { accountId, postId, xPostId, xUserId } from "../../../../src/entities/identity/ids";
import {
  IMPORT_BACKFILL,
  IMPORT_INTERVAL,
  importDue,
  importSince,
} from "../../../../src/entities/posts/imported_post";
import { DAY, HOUR, MINUTE, SECOND } from "../../../../src/entities/time/instant";
import type { BudgetMeter } from "../../../../src/use_cases/ports/budget_meter";
import { IMPORT_PAGES } from "../../../../src/use_cases/run_services/import_own_posts";
import { ACCOUNT, aPost, OTHER_ACCOUNT, part, sentState, T0 } from "../../support/builders";
import { meter } from "../../support/publishing";
import { makeWorld, type World } from "../../support/world";

/** A post on X, made `ago` before now; `account` defaults to ours. */
function onX(world: World, id: string, ago: number, account = ACCOUNT): void {
  world.x.posts.set(xPostId(id), {
    id: xPostId(id),
    account,
    text: `text ${id}`,
    media: [],
    inReplyTo: null,
    createdAt: world.clock.now() - ago,
  });
}

const run = (world: World, budget: BudgetMeter = meter(world.clock.now() + HOUR)) =>
  world.importPosts.import(ACCOUNT, budget);

const reads = (world: World) =>
  world.audit.events.filter((event) => event.action === "x.read").map((event) => event.detail);

/** A meter whose `fits` says yes `times` times, then no. */
function meterFor(times: number, inner: BudgetMeter): BudgetMeter {
  let left = times;
  return {
    fits: (cost, now) => {
      left -= 1;
      return left >= 0 && inner.fits(cost, now);
    },
    spend: (cost) => {
      inner.spend(cost);
    },
    remaining: () => inner.remaining(),
  };
}

describe("importDue and importSince (GROKCHAT-19)", () => {
  it("is due when never imported, or once the interval has passed", () => {
    expect(importDue(null, T0)).toBe(true);
    expect(importDue(null, 0)).toBe(true);
    expect(importDue(T0, T0 + IMPORT_INTERVAL - 1)).toBe(false);
    expect(importDue(T0, T0 + IMPORT_INTERVAL)).toBe(true);
    expect(IMPORT_INTERVAL).toBe(6 * HOUR);
  });

  it("starts the second after the newest post seen, never more than 30 days back", () => {
    expect(IMPORT_BACKFILL).toBe(30 * DAY);
    expect(importSince(null, T0)).toBe(T0 - 30 * DAY);
    expect(importSince(null, 0)).toBe(-IMPORT_BACKFILL);
    expect(importSince(T0 - HOUR, T0)).toBe(T0 - HOUR + SECOND);
    expect(importSince(T0 - 31 * DAY, T0)).toBe(T0 - 30 * DAY);
  });
});

describe("ImportOwnPosts (GROKCHAT-19)", () => {
  it("stores the account's posts GrokChat did not publish, and records the read", async () => {
    const world = makeWorld();
    await world.seedAccount();
    onX(world, "x-app", 2 * HOUR);
    onX(world, "x-ours", HOUR);
    onX(world, "x-too-old", 31 * DAY);
    onX(world, "x-other", HOUR, OTHER_ACCOUNT);
    world.table.rows.set(
      postId("p"),
      aPost({ lifecycle: "DONE", parts: [part("ours", sentState("x-ours", T0 - HOUR))] }),
    );
    expect(await run(world)).toBe(1);
    expect(await world.imported.list({})).toStrictEqual([
      {
        xPostId: xPostId("x-app"),
        accountId: ACCOUNT,
        text: "text x-app",
        createdAt: T0 - 2 * HOUR,
        inReplyTo: null,
        importedAt: T0,
      },
    ]);
    expect(await world.imported.cursor(ACCOUNT)).toStrictEqual({
      lastRunAt: T0,
      newestCreatedAt: T0 - HOUR,
    });
    expect(reads(world)).toStrictEqual(["imported 1 of 2"]);
    expect(world.costs.entries.map((entry) => entry.estimate)).toStrictEqual([
      { kind: "usd", micros: 10_000 },
    ]);
  });

  it("waits for the interval, then reads only posts after the newest seen", async () => {
    const world = makeWorld();
    await world.seedAccount();
    onX(world, "a", HOUR);
    expect(await run(world)).toBe(1);
    world.clock.advance(IMPORT_INTERVAL - MINUTE);
    onX(world, "b", 0);
    expect(await run(world)).toBe(0);
    world.clock.advance(MINUTE);
    expect(await run(world)).toBe(1);
    expect(reads(world)).toStrictEqual(["imported 1 of 1", "imported 1 of 1"]);
    world.clock.advance(IMPORT_INTERVAL);
    expect(await run(world)).toBe(0);
    expect(reads(world).at(-1)).toBe("imported 0 of 0");
  });

  it("reads every page, newest first, and stops after IMPORT_PAGES pages", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.x.pageSize = 2;
    for (let index = 0; index < 2 * IMPORT_PAGES + 1; index += 1) {
      onX(world, `p${String(index)}`, (index + 1) * MINUTE);
    }
    expect(await run(world)).toBe(2 * IMPORT_PAGES);
    expect(reads(world)).toHaveLength(IMPORT_PAGES);
    expect((await world.imported.list({})).map((post) => post.xPostId)).not.toContain("p10");
    expect((await world.imported.cursor(ACCOUNT)).newestCreatedAt).toBe(T0 - MINUTE);
  });

  it("a failed page finishes the run without moving the cursor", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.x.pageSize = 1;
    onX(world, "new", MINUTE);
    onX(world, "old", HOUR);
    world.x.scripts.timeline.push(
      { kind: "ok" },
      { kind: "fail", failure: { kind: "no_response" } },
    );
    expect(await run(world)).toBe(1);
    expect(reads(world)).toStrictEqual(["imported 1 of 1", "import failed: no_response"]);
    expect(await world.imported.cursor(ACCOUNT)).toStrictEqual({
      lastRunAt: T0,
      newestCreatedAt: null,
    });
    world.clock.advance(IMPORT_INTERVAL);
    expect(await run(world)).toBe(1);
    expect((await world.imported.list({})).map((post) => post.xPostId)).toStrictEqual([
      "old",
      "new",
    ]);
  });

  it("a run the budget cuts short is not finished, so the next tick takes it again", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.x.pageSize = 1;
    onX(world, "new", MINUTE);
    onX(world, "old", HOUR);
    // Due check, token step, page 1: then the budget is spent.
    expect(await run(world, meterFor(3, meter(T0 + HOUR)))).toBe(1);
    expect(await world.imported.cursor(ACCOUNT)).toStrictEqual({
      lastRunAt: null,
      newestCreatedAt: null,
    });
    expect(await run(world)).toBe(1);
    expect((await world.imported.cursor(ACCOUNT)).lastRunAt).toBe(T0);
  });

  it("budgets one page: the user id, the read, its records and the store", () => {
    expect(IMPORT_PAGE_COST).toStrictEqual({
      cloudflareCalls: 5,
      externalSubrequests: 1,
      millis: 2_000,
    });
  });

  it("a run that finds nothing keeps no newest post", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expect(await run(world)).toBe(0);
    expect(await world.imported.cursor(ACCOUNT)).toStrictEqual({
      lastRunAt: T0,
      newestCreatedAt: null,
    });
  });

  it("reads nothing when the page does not fit, or the token step stops it", async () => {
    const world = makeWorld();
    await world.seedAccount();
    onX(world, "a", HOUR);
    expect(await run(world, meter(T0 + IMPORT_PAGE_COST.millis - 1))).toBe(0);
    world.clock.advance(2 * HOUR - 5 * MINUTE);
    expect(await run(world, meter(world.clock.now() + TOKEN_REFRESH_MILLIS - 1))).toBe(0);
    expect(reads(world)).toStrictEqual([]);
    expect((await world.imported.cursor(ACCOUNT)).lastRunAt).toBeNull();
    expect(await run(world, meter(world.clock.now() + TOKEN_REFRESH_MILLIS + HOUR))).toBe(1);
  });

  it("imports a PAUSED account; never an unknown, lost or disconnected one", async () => {
    const paused = makeWorld();
    await paused.seedAccount({ status: "PAUSED" });
    onX(paused, "a", HOUR);
    expect(await run(paused)).toBe(1);
    for (const status of ["NEEDS_RECONNECT", "DISCONNECTED"] as const) {
      const other = makeWorld();
      await other.seedAccount({ status });
      onX(other, "a", HOUR);
      expect(await run(other)).toBe(0);
      expect(reads(other)).toStrictEqual([]);
    }
    expect(await makeWorld().importPosts.import(accountId("nobody"), meter())).toBe(0);
  });

  it("is single-flight per account; another account imports alongside", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await world.seedAccount({ id: OTHER_ACCOUNT, xUserId: xUserId("x-user-2") });
    onX(world, "a", HOUR);
    onX(world, "b", HOUR, OTHER_ACCOUNT);
    const other = world.importPosts.import(OTHER_ACCOUNT, meter());
    expect(await Promise.all([run(world), run(world), other])).toStrictEqual([1, 0, 1]);
    expect(reads(world)).toHaveLength(2);
  });

  it("an imported post's metrics are read on the same schedule as GrokChat's own", async () => {
    const world = makeWorld();
    await world.seedAccount();
    onX(world, "a", 30 * MINUTE);
    await run(world);
    onX(world, "elsewhere", DAY, OTHER_ACCOUNT);
    await world.imported.add([
      {
        xPostId: xPostId("elsewhere"),
        accountId: OTHER_ACCOUNT,
        text: "another account's",
        createdAt: T0 - DAY,
        inReplyTo: null,
        importedAt: T0,
      },
    ]);
    const collect = () => world.collectMetrics.collect(ACCOUNT, meter(world.clock.now() + HOUR));
    expect(await collect()).toStrictEqual({ ran: true, read: 0 });
    world.clock.advance(30 * MINUTE);
    expect(await collect()).toStrictEqual({ ran: true, read: 1 });
    expect(await collect()).toStrictEqual({ ran: true, read: 0 });
    expect((await world.metrics.latest([xPostId("a")]))[0]?.takenAt).toBe(T0 + 30 * MINUTE);
  });
});
