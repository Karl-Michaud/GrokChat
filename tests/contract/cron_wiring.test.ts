/**
 * The Worker's cron entry and the account object's per-invocation wiring, piece by piece (plan
 * §3.3 #5, #6, #8; §3.5): dispatch by `controller.cron`, the tick's own budget, the fan-out's
 * metering (U16), and one graph and one meter per DO invocation. The fetch drivers built around
 * that meter are tests/contract/x_wiring.test.ts.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DISPATCH_COST,
  INVOCATION_LIMITS,
  TOKEN_REFRESH_MILLIS,
  invocationBudget,
} from "../../src/entities/budget/budget";
import { accountId, postId, xPostId, type AccountId } from "../../src/entities/identity/ids";
import { MINUTE } from "../../src/entities/time/instant";
import { CRONS, dispatchScheduled, type CronJobs } from "../../src/frameworks/cron/dispatch";
import { TICK_WINDOWS, runTick, type TickJob } from "../../src/frameworks/cron/tick_runner";
import {
  GATEWAY_WINDOW,
  InvocationAccountPublisher,
  InvocationAccountReconciler,
  InvocationAccountXGateway,
  InvocationMetricsCollector,
  InvocationTokenProvider,
} from "../../src/frameworks/durable_objects/invocation_services";
import {
  MeteredAccountDispatch,
  type AccountDispatch,
} from "../../src/frameworks/durable_objects/metered_dispatch";
import { ManualClock } from "../../src/frameworks/memory/manual_clock";
import { InvocationBudgetMeter } from "../../src/frameworks/budget/invocation_meter";
import type { BudgetMeter } from "../../src/use_cases/ports/budget_meter";
import { T0 } from "../unit/support/builders";
import { FixedTokens } from "./support/x_fixtures";

const ACCOUNT = accountId("acc-wiring");
const FANOUT_LIMIT = 250;

describe("dispatchScheduled (plan §3.5: scheduled() dispatches by controller.cron)", () => {
  function jobs(ran: string[]): CronJobs {
    const job = (name: string): TickJob => ({
      job: name,
      window: MINUTE,
      build: (_meter, presenter) => ({
        execute: (input) => {
          ran.push(`${name}:${input.actor.job}`);
          presenter.present({
            job: input.actor.job,
            dispatched: 1,
            waiting: 0,
            found: 0,
            notFound: 0,
          });
          return Promise.resolve();
        },
      }),
    });
    return { publish: job("p"), reconcile: job("r"), metrics: job("m") };
  }

  it("the three schedules run their own tick, and each logs its summary", async () => {
    const ran: string[] = [];
    const lines: string[] = [];
    const clock = new ManualClock(T0);
    for (const cron of [CRONS.publish, CRONS.reconcile, CRONS.metrics]) {
      await dispatchScheduled(cron, jobs(ran), clock, (line) => lines.push(line));
    }
    expect(ran).toStrictEqual(["p:p", "r:r", "m:m"]);
    expect(lines).toStrictEqual([
      "tick p: dispatched=1 waiting=0 found=0 notFound=0",
      "tick r: dispatched=1 waiting=0 found=0 notFound=0",
      "tick m: dispatched=1 waiting=0 found=0 notFound=0",
    ]);
    expect(CRONS).toStrictEqual({
      publish: "* * * * *",
      reconcile: "*/10 * * * *",
      metrics: "*/15 * * * *",
    });
  });

  it("refuses a schedule that is none of the three, running nothing", async () => {
    const ran: string[] = [];
    await expect(dispatchScheduled("*/5 * * * *", jobs(ran), new ManualClock(T0))).rejects.toThrow(
      'no tick is scheduled as "*/5 * * * *"',
    );
    expect(ran).toStrictEqual([]);
  });
});

describe("dispatchScheduled, for any schedule", () => {
  it("runs exactly one tick for each of the three, and none for any other string", async () => {
    const known: readonly string[] = Object.values(CRONS);
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constantFrom(...known), fc.string({ maxLength: 20 })),
        async (cron) => {
          let runs = 0;
          const job: TickJob = {
            job: "j",
            window: MINUTE,
            build: () => ({
              execute: () => {
                runs += 1;
                return Promise.resolve();
              },
            }),
          };
          const done = dispatchScheduled(
            cron,
            { publish: job, reconcile: job, metrics: job },
            new ManualClock(T0),
          );
          if (known.includes(cron)) {
            await done;
            expect(runs).toBe(1);
          } else {
            await expect(done).rejects.toThrow("no tick is scheduled as");
            expect(runs).toBe(0);
          }
        },
      ),
    );
  });
});

describe("runTick: a fresh invocation budget per tick (U16)", () => {
  it("the meter holds the invocation's pools until the tick's window ends", async () => {
    const meters: BudgetMeter[] = [];
    const tick: TickJob = {
      job: "t",
      window: 3 * MINUTE,
      build: (meter) => {
        meters.push(meter);
        return { execute: () => Promise.resolve() };
      },
    };
    const lines: string[] = [];
    await runTick(tick, new ManualClock(T0), (line) => lines.push(line));
    expect(meters[0]?.remaining()).toStrictEqual(invocationBudget(T0 + 3 * MINUTE));
    expect(lines).toStrictEqual([]);
  });

  it("a tick that throws rejects, so Workers records the failed run", async () => {
    const tick: TickJob = {
      job: "t",
      window: MINUTE,
      build: () => ({ execute: () => Promise.reject(new Error("D1 down")) }),
    };
    await expect(runTick(tick, new ManualClock(T0))).rejects.toThrow("D1 down");
  });

  it("every window leaves a token refresh room and ends inside a cron run's 15 minutes", () => {
    for (const window of Object.values(TICK_WINDOWS)) {
      expect(window).toBeGreaterThan(TOKEN_REFRESH_MILLIS);
      expect(window).toBeLessThan(15 * MINUTE);
    }
    expect(TICK_WINDOWS.reconcile).toBeLessThan(10 * MINUTE);
    expect(TICK_WINDOWS.metrics).toBeLessThan(15 * MINUTE);
  });
});

describe("MeteredAccountDispatch: each DO call is one of the tick's Cloudflare-service calls", () => {
  it("spends before each call, forwards it unchanged, and spends even when the call fails", async () => {
    const calls: string[] = [];
    const inner: AccountDispatch = {
      publishDue: (a, n, d) => {
        calls.push(`due ${a} ${String(n)} ${String(d)}`);
        return Promise.resolve({ ran: true, sent: 1, touched: [], appRateLimited: false });
      },
      publishNow: (a, p, d) => {
        calls.push(`now ${a} ${p} ${String(d)}`);
        return Promise.resolve({ ran: true, sent: 0, touched: [], appRateLimited: false });
      },
      reconcile: (a, n, d) => {
        calls.push(`rec ${a} ${String(n)} ${String(d)}`);
        return Promise.resolve({ ran: true, found: 1, notFound: 0 });
      },
      collect: () => Promise.reject(new Error("reset")),
    };
    const meter = new InvocationBudgetMeter(invocationBudget(T0 + MINUTE));
    const dispatch = new MeteredAccountDispatch(inner, meter);
    expect((await dispatch.publishDue(ACCOUNT, 1, 2)).sent).toBe(1);
    expect((await dispatch.publishNow(ACCOUNT, postId("p"), 3)).ran).toBe(true);
    expect((await dispatch.reconcile(ACCOUNT, 4, 5)).found).toBe(1);
    await expect(dispatch.collect(ACCOUNT, 6, 7)).rejects.toThrow("reset");
    expect(calls).toStrictEqual([`due ${ACCOUNT} 1 2`, `now ${ACCOUNT} p 3`, `rec ${ACCOUNT} 4 5`]);
    expect(meter.remaining()).toStrictEqual({
      deadline: T0 + MINUTE,
      cloudflareCalls: INVOCATION_LIMITS.cloudflareCalls - 4 * DISPATCH_COST.cloudflareCalls,
      externalSubrequests: INVOCATION_LIMITS.externalSubrequests,
    });
  });
});

describe("MeteredAccountDispatch, for any fan-out", () => {
  it("n dispatches spend exactly n Cloudflare-service calls and no external subrequest", async () => {
    const summary = { ran: true, sent: 0, touched: [], appRateLimited: false };
    const inner: AccountDispatch = {
      publishDue: () => Promise.resolve(summary),
      publishNow: () => Promise.resolve(summary),
      reconcile: () => Promise.resolve({ ran: true, found: 0, notFound: 0 }),
      collect: () => Promise.resolve({ ran: true, imported: 0, read: 0, followers: 0 }),
    };
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: FANOUT_LIMIT }), async (n) => {
        const meter = new InvocationBudgetMeter(invocationBudget(T0));
        const dispatch = new MeteredAccountDispatch(inner, meter);
        for (let index = 0; index < n; index += 1) {
          await dispatch.publishDue(ACCOUNT, T0, T0);
        }
        expect(meter.remaining()).toStrictEqual({
          deadline: T0,
          cloudflareCalls: INVOCATION_LIMITS.cloudflareCalls - n,
          externalSubrequests: INVOCATION_LIMITS.externalSubrequests,
        });
      }),
    );
  });
});

describe("the account object's invocations: one graph and one meter each (plan §3.5)", () => {
  const recordingBuild = <T>(service: T) => {
    const built: { account: AccountId; meter: BudgetMeter }[] = [];
    const build = (account: AccountId, meter: BudgetMeter): T => {
      built.push({ account, meter });
      return service;
    };
    return { built, build };
  };

  it("publish, reconcile and metrics calls each build their graph around a meter until their deadline", async () => {
    const publish = recordingBuild({
      publishDue: (_a: AccountId, m: BudgetMeter) =>
        Promise.resolve({
          ran: true,
          sent: m.remaining().deadline,
          touched: [],
          appRateLimited: false,
        }),
      publishNow: (_a: AccountId, _p: unknown, m: BudgetMeter) =>
        Promise.resolve({
          ran: false,
          sent: m.remaining().deadline,
          touched: [],
          appRateLimited: false,
        }),
    });
    const publisher = new InvocationAccountPublisher(publish.build as never);
    expect((await publisher.publishDue(ACCOUNT, T0, T0 + 1)).sent).toBe(T0 + 1);
    expect((await publisher.publishNow(ACCOUNT, postId("p"), T0 + 2)).sent).toBe(T0 + 2);
    expect(publish.built.map((b) => b.account)).toStrictEqual([ACCOUNT, ACCOUNT]);
    expect(publish.built[0]?.meter).not.toBe(publish.built[1]?.meter);
    expect(publisher.meters).toStrictEqual(publish.built.map((b) => b.meter));
    expect(publisher.meters[1]?.remaining()).toStrictEqual(invocationBudget(T0 + 2));

    const reconcile = recordingBuild({
      reconcile: (_a: AccountId, m: BudgetMeter) =>
        Promise.resolve({ ran: true, found: m.remaining().deadline, notFound: 0 }),
    });
    const reconciler = new InvocationAccountReconciler(reconcile.build as never);
    expect((await reconciler.reconcile(ACCOUNT, T0, T0 + 3)).found).toBe(T0 + 3);

    const collect = recordingBuild({
      collect: (_a: AccountId, m: BudgetMeter) =>
        Promise.resolve({ ran: true, read: m.remaining().deadline }),
    });
    const collector = new InvocationMetricsCollector(collect.build as never);
    expect((await collector.collect(ACCOUNT, T0, T0 + 4)).read).toBe(T0 + 4);
  });

  it("deletes and token stores carry no deadline: they get the gateway window from now", async () => {
    const seen: number[] = [];
    const gateway = {
      deletePost: () => Promise.resolve([{ xPostId: xPostId("x"), deleted: true }]),
      storeConnectedTokens: () => Promise.resolve(),
    };
    const clock = new ManualClock(T0);
    const invocations = new InvocationAccountXGateway((account, meter) => {
      expect(account).toBe(ACCOUNT);
      seen.push(meter.remaining().deadline);
      return gateway;
    }, clock);
    expect(await invocations.deletePost(ACCOUNT, [xPostId("x")])).toStrictEqual([
      { xPostId: xPostId("x"), deleted: true },
    ]);
    clock.advance(MINUTE);
    await invocations.storeConnectedTokens(ACCOUNT, tokenSet());
    expect(seen).toStrictEqual([T0 + GATEWAY_WINDOW, T0 + MINUTE + GATEWAY_WINDOW]);
    expect(GATEWAY_WINDOW).toBeGreaterThan(TOKEN_REFRESH_MILLIS);
  });

  it("a token asked for on its own is metered until the caller's deadline", async () => {
    const tokens = new FixedTokens();
    let deadline = 0;
    const provider = new InvocationTokenProvider((_account, meter) => {
      deadline = meter.remaining().deadline;
      return tokens;
    });
    expect(await provider.accessToken(ACCOUNT, T0 + 7)).toStrictEqual({
      kind: "token",
      accessToken: "access-1",
    });
    expect(deadline).toBe(T0 + 7);
    expect(tokens.deadlines).toStrictEqual([T0 + 7]);
  });
});

function tokenSet() {
  return { accessToken: "a", refreshToken: "r", accessExpiresAt: T0 + 2 * 60 * MINUTE };
}
