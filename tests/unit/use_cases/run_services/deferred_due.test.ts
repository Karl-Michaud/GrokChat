/**
 * A first part held back (by the gate or by X's retryAt) waits for that time, and `missed` counts
 * from it, not from publishAt (plan §3.1.1). One tick a minute, as the cron runs.
 */
import { describe, expect, it } from "vitest";
import { postId } from "../../../../src/entities/identity/ids";
import { MINUTE } from "../../../../src/entities/time/instant";
import { ACCOUNT, aPost, T0 } from "../../support/builders";
import { makeWorld, type World } from "../../support/world";
import { http, meter, put, stored } from "../../support/publishing";

async function tickEveryMinute(world: World, minutes: number): Promise<void> {
  for (let minute = 0; minute <= minutes; minute += 1) {
    await world.publishPost.publishDue(ACCOUNT, meter(world.clock.now() + MINUTE));
    world.clock.advance(MINUTE);
  }
}

function countCreates(world: World): () => readonly number[] {
  const at: number[] = [];
  world.x.beforeCreate = () => {
    at.push(world.clock.now());
    return Promise.resolve();
  };
  return () => at;
}

describe("a first part held back is due again at its not-before time", () => {
  it("two posts due together (a tick a minute late) both publish, 30 min apart", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(world, aPost({ id: postId("p-1"), publishAt: T0 - MINUTE }));
    put(world, aPost({ id: postId("p-2"), publishAt: T0 - MINUTE }));
    await tickEveryMinute(world, 70);
    expect([
      stored(world, postId("p-1"))?.lifecycle,
      stored(world, postId("p-2"))?.lifecycle,
    ]).toStrictEqual(["DONE", "DONE"]);
    const created = [...world.x.posts.values()].map((post) => post.createdAt);
    expect(created).toStrictEqual([T0, T0 + 30 * MINUTE]);
  });

  it("a user 429 on the first part: no second create before X's retryAt, then it publishes", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(world, aPost({ publishAt: T0 }));
    const creates = countCreates(world);
    world.x.scripts.create.push({ kind: "fail", failure: http(429, "user", T0 + 15 * MINUTE) });
    await tickEveryMinute(world, 14);
    expect(creates()).toStrictEqual([T0]);
    expect(stored(world)).toMatchObject({ lifecycle: "SCHEDULED", resumeAt: T0 + 15 * MINUTE });
    await tickEveryMinute(world, 0);
    expect(creates()).toStrictEqual([T0, T0 + 15 * MINUTE]);
    expect(stored(world)?.lifecycle).toBe("DONE");
  });

  it("still missed when no tick runs within the grace after the not-before time", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(world, aPost({ publishAt: T0 }));
    world.x.scripts.create.push({ kind: "fail", failure: http(429, "user", T0 + 15 * MINUTE) });
    await tickEveryMinute(world, 0);
    world.clock.advance(15 * MINUTE + 30 * MINUTE);
    await tickEveryMinute(world, 0);
    expect(stored(world)?.lifecycle).toBe("MISSED");
  });
});
