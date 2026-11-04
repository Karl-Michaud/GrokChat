/** MediaCleanup inside the metrics tick's budget (plan §3.5, U16): bounded, metered, oldest first. */
import { describe, expect, it } from "vitest";
import {
  invocationBudget,
  MEDIA_CLEANUP_BATCH,
  MEDIA_CLEANUP_ITEM_COST,
  MEDIA_CLEANUP_QUERY_COST,
} from "../../../../src/entities/budget/budget";
import { stagedMediaId } from "../../../../src/entities/identity/ids";
import { DAY, HOUR } from "../../../../src/entities/time/instant";
import { InvocationBudgetMeter } from "../../../../src/frameworks/budget/invocation_meter";
import { aMedia, T0 } from "../../support/builders";
import { makeWorld, type World } from "../../support/world";

const meterUntil = (deadline: number) => new InvocationBudgetMeter(invocationBudget(deadline));

describe("MediaCleanup inside the tick's budget (U16)", () => {
  const QUERY = MEDIA_CLEANUP_QUERY_COST.cloudflareCalls;
  const ITEM = MEDIA_CLEANUP_ITEM_COST.cloudflareCalls;

  async function dueItems(world: World, count: number) {
    for (let index = 0; index < count; index += 1) {
      await world.media.save(
        aMedia({
          id: stagedMediaId(`due-${String(index).padStart(3, "0")}`),
          storageKey: `key-${String(index)}`,
          stagedAt: T0 + index,
        }),
      );
    }
    world.clock.advance(3 * DAY);
  }

  const left = (world: World) => [...world.media.rows.keys()].map(String);

  it("spends one query and each deleted item's cost, oldest staged first", async () => {
    const world = makeWorld();
    await dueItems(world, 3);
    const meter = meterUntil(world.clock.now() + HOUR);
    expect(await world.cleanup.run(meter)).toBe(3);
    expect(meter.remaining().cloudflareCalls).toBe(1000 - QUERY - 3 * ITEM);
    expect(meter.remaining().externalSubrequests).toBe(50);
    expect(left(world)).toStrictEqual([]);
  });

  it(`asks for at most ${String(MEDIA_CLEANUP_BATCH)} items; the rest wait for the next tick`, async () => {
    const world = makeWorld();
    await dueItems(world, MEDIA_CLEANUP_BATCH + 2);
    const asked: number[] = [];
    const due = world.cleanupCandidates.due.bind(world.cleanupCandidates);
    world.cleanupCandidates.due = (now, limit) => {
      asked.push(limit);
      return due(now, limit);
    };
    expect(await world.cleanup.run(meterUntil(world.clock.now() + HOUR))).toBe(MEDIA_CLEANUP_BATCH);
    expect(asked).toStrictEqual([MEDIA_CLEANUP_BATCH]);
    expect(left(world)).toStrictEqual(["due-100", "due-101"]);
    expect(await world.cleanup.run(meterUntil(world.clock.now() + HOUR))).toBe(2);
    expect(left(world)).toStrictEqual([]);
  });

  it("a nearly spent meter deletes only what fits and never overspends", async () => {
    const world = makeWorld();
    await dueItems(world, 5);
    const meter = new InvocationBudgetMeter({
      deadline: world.clock.now() + HOUR,
      cloudflareCalls: QUERY + 2 * ITEM + ITEM - 1,
      externalSubrequests: 0,
    });
    expect(await world.cleanup.run(meter)).toBe(2);
    expect(meter.remaining().cloudflareCalls).toBe(ITEM - 1);
    expect(left(world)).toStrictEqual(["due-002", "due-003", "due-004"]);
  });

  it("exactly one item's room deletes one; less runs no query at all", async () => {
    const world = makeWorld();
    await dueItems(world, 2);
    const exact = new InvocationBudgetMeter({
      deadline: world.clock.now() + HOUR,
      cloudflareCalls: QUERY + ITEM,
      externalSubrequests: 0,
    });
    expect(await world.cleanup.run(exact)).toBe(1);
    expect(exact.remaining().cloudflareCalls).toBe(0);
    let queried = false;
    world.cleanupCandidates.due = () => {
      queried = true;
      return Promise.resolve([]);
    };
    const short = new InvocationBudgetMeter({
      deadline: world.clock.now() + HOUR,
      cloudflareCalls: QUERY + ITEM - 1,
      externalSubrequests: 0,
    });
    expect(await world.cleanup.run(short)).toBe(0);
    expect(queried).toBe(false);
    expect(short.remaining().cloudflareCalls).toBe(QUERY + ITEM - 1);
  });

  it("stops at the deadline: neither the query nor an item starts once its time is gone", async () => {
    const world = makeWorld();
    await dueItems(world, 3);
    const now = world.clock.now();
    const noTime = meterUntil(now + MEDIA_CLEANUP_QUERY_COST.millis - 1);
    expect(await world.cleanup.run(noTime)).toBe(0);
    expect(noTime.remaining().cloudflareCalls).toBe(1000);
    // Room for the query and one item's wall time: the second item does not start.
    const blobs = world.blobs.delete.bind(world.blobs);
    world.blobs.delete = (key) => {
      world.clock.advance(MEDIA_CLEANUP_ITEM_COST.millis);
      return blobs(key);
    };
    const oneItem = meterUntil(now + MEDIA_CLEANUP_ITEM_COST.millis);
    expect(await world.cleanup.run(oneItem)).toBe(1);
    expect(left(world)).toStrictEqual(["due-001", "due-002"]);
  });
});
