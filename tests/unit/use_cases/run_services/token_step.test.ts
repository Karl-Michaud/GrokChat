/** The token step reconcile and metrics take before their first X call (N1, A2, R18). */
import { describe, expect, it } from "vitest";
import {
  invocationBudget,
  METRICS_READ_COST,
  TOKEN_REFRESH_MILLIS,
  TOKEN_STEP_CALLS,
} from "../../../../src/entities/budget/budget";
import { postId, xPostId } from "../../../../src/entities/identity/ids";
import type { Post } from "../../../../src/entities/posts/post";
import { DAY, HOUR, MINUTE, SECOND } from "../../../../src/entities/time/instant";
import { InvocationBudgetMeter } from "../../../../src/frameworks/budget/invocation_meter";
import { ACCOUNT, aPost, part, sentState, T0, unknownState } from "../../support/builders";
import { makeWorld, type World } from "../../support/world";

const meter = (deadline = T0 + HOUR): InvocationBudgetMeter =>
  new InvocationBudgetMeter(invocationBudget(deadline));

function put(world: World, post: Post): Post {
  world.table.rows.set(post.id, post);
  return post;
}

describe("the token step before reconcile and metrics (N1, A2, R18)", () => {
  /** An UNKNOWN part to reconcile and a SENT post whose metrics are due, an hour after T0. */
  async function work(world: World): Promise<void> {
    await world.seedAccount({ isAppOwner: true });
    put(world, aPost({ lifecycle: "DONE", parts: [part("u", unknownState(0, T0))] }));
    const id = xPostId("x-sent");
    world.x.posts.set(id, {
      id,
      account: ACCOUNT,
      text: "s",
      media: [],
      inReplyTo: null,
      createdAt: T0,
    });
    put(
      world,
      aPost({ id: postId("p-sent"), lifecycle: "DONE", parts: [part("s", sentState(id))] }),
    );
  }

  /** The token expires in five minutes: inside the ten-minute refresh margin. */
  const expiring = (world: World): void => {
    world.clock.advance(2 * HOUR - 5 * MINUTE);
  };

  it("a refresh that does not fit the deadline yields both runs before any call to X", async () => {
    const world = makeWorld();
    await work(world);
    expiring(world);
    const short = (): InvocationBudgetMeter => meter(world.clock.now() + TOKEN_REFRESH_MILLIS - 1);
    expect(await world.reconcileAccount.reconcile(ACCOUNT, short())).toStrictEqual({
      ran: true,
      found: 0,
      notFound: 0,
    });
    expect(await world.collectMetrics.collect(ACCOUNT, short())).toStrictEqual({
      ran: true,
      read: 0,
    });
    expect(world.tokenEndpoint.calls).toStrictEqual([]);
    expect(world.audit.events).toStrictEqual([]);
    expect(world.metrics.snapshots).toStrictEqual([]);
    expect(world.table.rows.get(postId("post-1"))?.parts[0]?.state.kind).toBe("UNKNOWN");
  });

  it("with the refresh's minute left, the token is refreshed once and both runs read", async () => {
    const world = makeWorld();
    await work(world);
    expiring(world);
    const enough = (): InvocationBudgetMeter =>
      meter(world.clock.now() + TOKEN_REFRESH_MILLIS + HOUR);
    expect((await world.reconcileAccount.reconcile(ACCOUNT, enough())).notFound).toBe(1);
    expect((await world.collectMetrics.collect(ACCOUNT, enough())).read).toBe(1);
    expect(world.tokenEndpoint.calls).toStrictEqual(["refresh-1"]);
  });

  it("no work: no token step, so no refresh", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expiring(world);
    await world.reconcileAccount.reconcile(ACCOUNT, meter(world.clock.now() + DAY));
    await world.collectMetrics.collect(ACCOUNT, meter(world.clock.now() + DAY));
    expect(world.tokenEndpoint.calls).toStrictEqual([]);
  });

  it("a lost token, or no room for the token step's calls: nothing is read", async () => {
    const world = makeWorld();
    await work(world);
    world.clock.advance(HOUR);
    const cramped = (): InvocationBudgetMeter =>
      new InvocationBudgetMeter({
        deadline: T0 + DAY,
        cloudflareCalls: 1_000,
        externalSubrequests: TOKEN_STEP_CALLS.externalSubrequests - 1,
      });
    expect((await world.reconcileAccount.reconcile(ACCOUNT, cramped())).notFound).toBe(0);
    expect((await world.collectMetrics.collect(ACCOUNT, cramped())).read).toBe(0);
    await world.tokenStore.markRefreshing(ACCOUNT, world.clock.now());
    expect((await world.reconcileAccount.reconcile(ACCOUNT, meter(T0 + DAY))).notFound).toBe(0);
    expect((await world.collectMetrics.collect(ACCOUNT, meter(T0 + DAY))).read).toBe(0);
    expect(world.audit.events).toStrictEqual([]);
    expect(world.tokenEndpoint.calls).toStrictEqual([]);
  });

  it("the token step's Cloudflare calls must fit even where a metrics read's would", async () => {
    const world = makeWorld();
    await work(world);
    world.clock.advance(HOUR);
    expect(METRICS_READ_COST.cloudflareCalls).toBeLessThan(TOKEN_STEP_CALLS.cloudflareCalls);
    const between = new InvocationBudgetMeter({
      deadline: T0 + DAY,
      cloudflareCalls: TOKEN_STEP_CALLS.cloudflareCalls - 1,
      externalSubrequests: 50,
    });
    expect(await world.collectMetrics.collect(ACCOUNT, between)).toStrictEqual({
      ran: true,
      read: 0,
    });
    expect(world.metrics.snapshots).toStrictEqual([]);
  });

  it("a usable token, but no time left for a read: the runs stop before reading", async () => {
    const world = makeWorld();
    await work(world);
    world.clock.advance(HOUR);
    const late = (): InvocationBudgetMeter => meter(world.clock.now() + SECOND);
    expect(await world.reconcileAccount.reconcile(ACCOUNT, late())).toStrictEqual({
      ran: true,
      found: 0,
      notFound: 0,
    });
    expect((await world.collectMetrics.collect(ACCOUNT, late())).read).toBe(0);
    expect(world.audit.events).toStrictEqual([]);
  });
});
