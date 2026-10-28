/**
 * The ticks' budgets through the composition root's own wiring (`cronJobs`, `buildAccountServices`
 * in src/main.ts) over real local D1, R2 and Durable Objects (plan §4): R15 an inline publishNow
 * that runs out of time after part 1 of 3 is finished by the next publish tick; R16 the tick's
 * fan-out ceiling (200, oldest due first, each dispatch one Cloudflare-service call) and each
 * part's worst-case budget on the fetch drivers (U16); the metrics tick's staged-media cleanup
 * stays inside what its meter has left, and later ticks finish the deletes.
 */
import { listDurableObjectIds } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FANOUT_CEILING,
  INVOCATION_LIMITS,
  MEDIA_CLEANUP_BATCH,
  MEDIA_CLEANUP_ITEM_COST,
  MEDIA_CLEANUP_QUERY_COST,
  partCost,
  type CallCost,
} from "../../src/entities/budget/budget";
import { accountId, postId, stagedMediaId, type AccountId } from "../../src/entities/identity/ids";
import { DAY, MINUTE, SECOND } from "../../src/entities/time/instant";
import type { TickJob } from "../../src/frameworks/cron/tick_runner";
import { runTick } from "../../src/frameworks/cron/tick_runner";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { AccountObjects } from "../../src/frameworks/durable_objects/account_client";
import { HttpXWiring } from "../../src/frameworks/durable_objects/http_x_wiring";
import type { InvocationAccountPublisher } from "../../src/frameworks/durable_objects/invocation_services";
import { ManualClock } from "../../src/frameworks/memory/manual_clock";
import { MemoryLocks, MemorySingleFlight } from "../../src/frameworks/durable_objects/object_locks";
import { MemoryAccountRepository } from "../../src/frameworks/memory/memory_repositories";
import { MemoryTokenStore } from "../../src/frameworks/memory/memory_tokens";
import { MemoryAuditLog, MemoryCostLedger } from "../../src/frameworks/memory/memory_records";
import { AccountXUserDirectory } from "../../src/frameworks/x_http/x_user_directory";
import type { BudgetMeter } from "../../src/use_cases/ports/budget_meter";
import { XCallRecorder } from "../../src/use_cases/run_services/x_call_recorder";
import { buildAccountServices } from "../../src/frameworks/composition/account_graph";
import { cronJobs } from "../../src/frameworks/composition/cron_jobs";
import { XEmulator } from "../contract/support/x_emulator";
import { FixtureTransport } from "../contract/support/x_fixtures";
import { aMedia, aPolicy, anAccount, aPost, part, T0 } from "../unit/support/builders";
import { freshStorage } from "./support/fresh_d1";
import { metered } from "./support/metered_d1";
import { newHarness, seedAccount } from "./support/harness";

beforeEach(freshStorage);

const stores = () => d1Stores(env.DB);

/** The D1 reads a publish run makes before its first part (PublishPost.due). */
const RUN_SETUP_CALLS = 3;

/** The publish tick as main.ts builds it, over the test objects, recording its meter. */
function publishTick(clock: ManualClock, meters: BudgetMeter[] = []): TickJob {
  const job = cronJobs({
    db: env.DB,
    accounts: env.TEST_ACCOUNT,
    bucket: env.MEDIA,
    clock,
  }).publish;
  return {
    ...job,
    build: (meter, presenter) => {
      meters.push(meter);
      return job.build(meter, presenter);
    },
  };
}

describe("R15: a budget yield inline is finished by the next tick", () => {
  it("publishNow runs out of time after part 1 of 3; the publish tick sends parts 2 and 3 as replies", async () => {
    const h = newHarness();
    const account = await seedAccount({ policy: aPolicy({ minGap: 0 }) });
    const id = postId(`${account.id}-thread`);
    await stores().writer.add(
      aPost({
        id,
        accountId: account.id,
        publishAt: T0 - MINUTE,
        parts: [part("one"), part("two"), part("three")],
      }),
    );
    // Each send takes a second, and the inline call leaves room for one part's worst case only.
    h.x.beforeCreate = () => {
      h.clock.advance(SECOND);
      return Promise.resolve();
    };
    const deadline = T0 + partCost([]).millis + SECOND / 2;
    const inline = await new AccountObjects(env.TEST_ACCOUNT).publishNow(account.id, id, deadline);
    expect(inline).toMatchObject({ ran: true, sent: 1 });
    const yielded = await stores().reader.get(id);
    expect(yielded?.lifecycle).toBe("RESUMING");
    expect(yielded?.parts.map((p) => p.state.kind)).toStrictEqual(["SENT", "PENDING", "PENDING"]);

    const lines: string[] = [];
    await runTick(publishTick(h.clock), h.clock, (line) => lines.push(line));
    expect(lines).toStrictEqual([
      "tick publish_due: dispatched=1 waiting=0 stoppedForAppLimit=false",
    ]);
    const done = await stores().reader.get(id);
    expect(done?.lifecycle).toBe("DONE");
    expect(done?.parts.map((p) => p.state.kind)).toStrictEqual(["SENT", "SENT", "SENT"]);
    const sent = h.x.postsBy(account.id);
    expect(sent.map((post) => post.text)).toStrictEqual(["one", "two", "three"]);
    expect(sent.map((post) => post.inReplyTo)).toStrictEqual([null, sent[0]?.id, sent[1]?.id]);
  });
});

describe("R16: the publish tick's fan-out ceiling (U16)", () => {
  it(`dispatches the ${String(FANOUT_CEILING)} oldest due accounts, one Cloudflare-service call each; the rest wait`, async () => {
    const h = newHarness();
    const accounts: AccountId[] = Array.from({ length: FANOUT_CEILING + 1 }, (_, index) =>
      accountId(`fan-${String(index).padStart(3, "0")}`),
    );
    // The last account's post is the youngest due: it is the one left for the next minute.
    const rows = accounts.map((account, index) =>
      aPost({
        id: postId(`${account}-p`),
        accountId: account,
        publishAt: T0 - 10 * MINUTE + index * SECOND,
      }),
    );
    for (const row of rows) {
      await stores().writer.add(row);
    }
    const before = new Set((await listDurableObjectIds(env.TEST_ACCOUNT)).map(String));
    const meters: BudgetMeter[] = [];
    const lines: string[] = [];
    await runTick(publishTick(h.clock, meters), h.clock, (line) => lines.push(line));

    expect(lines).toStrictEqual([
      "tick publish_due: dispatched=200 waiting=1 stoppedForAppLimit=false",
    ]);
    expect(meters[0]?.remaining().cloudflareCalls).toBe(
      INVOCATION_LIMITS.cloudflareCalls - FANOUT_CEILING,
    );
    const called = (await listDurableObjectIds(env.TEST_ACCOUNT))
      .map(String)
      .filter((object) => !before.has(object));
    expect(called).toHaveLength(FANOUT_CEILING);
    const youngest = String(env.TEST_ACCOUNT.idFromName(accounts.at(-1) ?? ""));
    const oldest = String(env.TEST_ACCOUNT.idFromName(accounts[0] ?? ""));
    expect(called).not.toContain(youngest);
    expect(called).toContain(oldest);
    // 201 posts and 200 Durable Objects: about 1 s alone, but over vitest's 5 s default when the
    // full suite runs every workerd file in parallel (seen in GROKCHAT-13's `npm run check`).
  }, 30_000);
});

describe("R16: each part's worst case on the production graph and the fetch drivers (A4, U16)", () => {
  const external = (meter: BudgetMeter | undefined) =>
    INVOCATION_LIMITS.externalSubrequests - (meter?.remaining().externalSubrequests ?? 0);

  async function setup() {
    const clock = new ManualClock(T0);
    const d1 = metered(env.DB);
    const transport = new FixtureTransport(new XEmulator(() => clock.now()).handle);
    const account = anAccount({ id: accountId("budget-acc"), policy: aPolicy({ minGap: 0 }) });
    await stores().accounts.save(account);
    const tokens = new MemoryTokenStore();
    await tokens.commitRotated(account.id, {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      accessExpiresAt: T0 + 2 * 60 * MINUTE,
    });
    const users = new MemoryAccountRepository();
    await users.save(account);
    const x = new HttpXWiring({
      transport,
      credentials: { clientId: "id", clientSecret: "secret" },
      recorder: new XCallRecorder(new MemoryAuditLog(), new MemoryCostLedger()),
      users: new AccountXUserDirectory(users),
      clock,
      defer: () => undefined,
      wait: () => Promise.resolve(),
    });
    const services = buildAccountServices({
      db: d1.db,
      bucket: env.MEDIA,
      tokens,
      locks: new MemoryLocks(clock, clock),
      flights: new MemorySingleFlight(),
      clock,
      x,
    });
    return { account, d1, transport, services };
  }

  async function stageGif(account: AccountId): Promise<ReturnType<typeof aMedia>> {
    const gif = aMedia({
      id: stagedMediaId("budget-gif"),
      ownerAccountId: account,
      kind: "GIF",
      contentType: "image/gif",
      size: 6,
      storageKey: "budget-gif-key",
    });
    await stores().media.save(gif);
    await env.MEDIA.put(gif.storageKey, new TextEncoder().encode("GIF89a"));
    return gif;
  }

  it("a thread spends one external subrequest per plain part and a GIF part's at most its worst case; D1 calls stay inside", async () => {
    const { account, d1, transport, services } = await setup();
    const gif = await stageGif(account.id);
    await stores().writer.add(
      aPost({
        id: postId("budget-thread"),
        accountId: account.id,
        publishAt: T0 - MINUTE,
        parts: [part("one"), part("two", undefined, [gif.id]), part("three")],
      }),
    );
    const publisher = services.publisher as InvocationAccountPublisher;
    const summary = await publisher.publishDue(account.id, T0, T0 + 10 * MINUTE);
    expect(summary).toMatchObject({ ran: true, sent: 3 });

    const worst: CallCost[] = [partCost([]), partCost(["GIF"]), partCost([])];
    const requests = transport.seen.map((seen) => `${seen.method} ${seen.url.pathname}`);
    const creates = requests.flatMap((request, index) =>
      request === "POST /2/tweets" ? [index] : [],
    );
    expect(creates).toHaveLength(3);
    // Requests per part: those up to and including its create.
    const perPart = creates.map((at, index) => at - (index === 0 ? -1 : (creates[index - 1] ?? 0)));
    perPart.forEach((count, index) => {
      expect(count).toBeLessThanOrEqual(worst[index]?.externalSubrequests ?? 0);
    });
    expect(perPart[0]).toBe(1);
    expect(perPart[2]).toBe(1);
    expect(external(publisher.meters[0])).toBe(transport.seen.length);
    const worstD1 = worst.reduce((sum, cost) => sum + cost.cloudflareCalls, 0);
    // Before its parts a run reads three times: recovery's list, the account, the due posts.
    expect(d1.calls).toBeLessThanOrEqual(worstD1 + RUN_SETUP_CALLS);
    // The GIF went chunked: INIT, one APPEND, FINALIZE, then the create.
    expect(perPart[1]).toBe(4);
  });
});

describe("R16: the metrics tick's staged-media cleanup stays inside the tick's budget (U16)", () => {
  /** Unused staged media, each with its R2 object, all past their 2 days. */
  async function stageUnused(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const key = `cleanup-${String(index).padStart(3, "0")}`;
      await stores().media.save(
        aMedia({ id: stagedMediaId(key), storageKey: key, stagedAt: T0 - 3 * DAY + index }),
      );
      await env.MEDIA.put(key, new Uint8Array([1]));
    }
  }

  /** The metrics tick as main.ts builds it, its meter left with `room` Cloudflare-service calls. */
  function metricsTick(clock: ManualClock, db: D1Database, room?: number): TickJob {
    const job = cronJobs({ db, accounts: env.TEST_ACCOUNT, bucket: env.MEDIA, clock }).metrics;
    return {
      ...job,
      build: (meter, presenter) => {
        if (room !== undefined) {
          meter.spend({
            cloudflareCalls: meter.remaining().cloudflareCalls - room,
            externalSubrequests: 0,
          });
        }
        return job.build(meter, presenter);
      },
    };
  }

  const objects = async () => (await env.MEDIA.list()).objects.length;

  it("a nearly spent meter deletes what fits, never more calls than it had; later ticks finish", async () => {
    const clock = new ManualClock(T0);
    const total = MEDIA_CLEANUP_BATCH + 50;
    await stageUnused(total);
    const fits = 7;
    const room =
      MEDIA_CLEANUP_QUERY_COST.cloudflareCalls +
      fits * MEDIA_CLEANUP_ITEM_COST.cloudflareCalls +
      MEDIA_CLEANUP_ITEM_COST.cloudflareCalls -
      1;
    const d1 = metered(env.DB);
    const lines: string[] = [];
    await runTick(metricsTick(clock, d1.db, room), clock, (line) => lines.push(line));
    expect(lines).toStrictEqual([
      `tick metrics: dispatched=0 waiting=0 imported=0 read=0 followers=0 mediaDeleted=${String(fits)}`,
    ]);
    // The cleanup's D1 calls and one R2 delete per item; the tick's three work queries (post
    // metrics, follower snapshots, imports) are not its.
    const cleanupCalls = d1.calls - 3 + fits;
    expect(cleanupCalls).toBeLessThanOrEqual(room);
    expect(await objects()).toBe(total - fits);

    // A full budget takes at most the batch per tick, oldest first; the next tick takes the rest.
    const full = metered(env.DB);
    lines.length = 0;
    await runTick(metricsTick(clock, full.db), clock, (line) => lines.push(line));
    expect(full.calls - 3 + MEDIA_CLEANUP_BATCH).toBeLessThanOrEqual(
      MEDIA_CLEANUP_QUERY_COST.cloudflareCalls +
        MEDIA_CLEANUP_BATCH * MEDIA_CLEANUP_ITEM_COST.cloudflareCalls,
    );
    await runTick(metricsTick(clock, env.DB), clock, (line) => lines.push(line));
    expect(lines).toStrictEqual([
      `tick metrics: dispatched=0 waiting=0 imported=0 read=0 followers=0 mediaDeleted=${String(MEDIA_CLEANUP_BATCH)}`,
      `tick metrics: dispatched=0 waiting=0 imported=0 read=0 followers=0 mediaDeleted=${String(total - fits - MEDIA_CLEANUP_BATCH)}`,
    ]);
    expect(await objects()).toBe(0);
    expect(await stores().media.list()).toStrictEqual([]);
  });

  it("items not yet due cost the tick nothing and never hold back the due ones behind them", async () => {
    const clock = new ManualClock(T0);
    await stores().writer.add(aPost({ id: postId("waiting"), lifecycle: "SCHEDULED" }));
    for (let index = 0; index < MEDIA_CLEANUP_BATCH + 10; index += 1) {
      await stores().media.save(
        aMedia({
          id: stagedMediaId(`kept-${String(index).padStart(3, "0")}`),
          storageKey: `kept-${String(index)}`,
          stagedAt: T0 - 30 * DAY,
          attachedTo: postId("waiting"),
        }),
      );
    }
    await stageUnused(2);
    const d1 = metered(env.DB);
    const lines: string[] = [];
    await runTick(metricsTick(clock, d1.db), clock, (line) => lines.push(line));
    expect(lines).toStrictEqual([
      "tick metrics: dispatched=0 waiting=0 imported=0 read=0 followers=0 mediaDeleted=2",
    ]);
    // The three work queries (post metrics, follower snapshots, imports, GROKCHAT-19), the
    // candidates query, and two D1 writes per deleted item.
    expect(d1.calls).toBe(3 + 1 + 2 * 2);
    expect(await stores().media.list()).toHaveLength(MEDIA_CLEANUP_BATCH + 10);
  });
});
