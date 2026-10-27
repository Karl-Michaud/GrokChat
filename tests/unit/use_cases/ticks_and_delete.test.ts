import { describe, expect, it } from "vitest";
import { invocationBudget } from "../../../src/entities/budget/budget";
import { accountId, postId, xPostId, type AccountId } from "../../../src/entities/identity/ids";
import type { Post } from "../../../src/entities/posts/post";
import { DAY, HOUR, MINUTE } from "../../../src/entities/time/instant";
import { InvocationBudgetMeter } from "../../../src/frameworks/budget/invocation_meter";
import { DeletePostInteractor } from "../../../src/use_cases/delete_post/interactor";
import type { DeletePostOutputData } from "../../../src/use_cases/delete_post/output_data";
import { MetricsTickInteractor } from "../../../src/use_cases/metrics_tick/interactor";
import type { MetricsTickOutputData } from "../../../src/use_cases/metrics_tick/output_data";
import type { AccountPublisher } from "../../../src/use_cases/ports/account_publisher";
import type { AccountWork, PostReader } from "../../../src/use_cases/ports/post_reader";
import { PublishDueTickInteractor } from "../../../src/use_cases/publish_due_tick/interactor";
import type { PublishDueTickOutputData } from "../../../src/use_cases/publish_due_tick/output_data";
import { ReconcileTickInteractor } from "../../../src/use_cases/reconcile_tick/interactor";
import type { ReconcileTickOutputData } from "../../../src/use_cases/reconcile_tick/output_data";
import {
  ACCOUNT,
  aPost,
  botActor,
  HUMAN,
  OTHER_ACCOUNT,
  part,
  sentState,
  SYSTEM,
  T0,
  unknownState,
} from "../support/builders";
import { Capture, makeWorld, type World } from "../support/world";

const SYSTEM_ACTOR = { kind: "system", job: "cron" } as const;
const meter = (deadline = T0 + HOUR): InvocationBudgetMeter =>
  new InvocationBudgetMeter(invocationBudget(deadline));

function work(id: string, flags: Partial<AccountWork> = {}): AccountWork {
  return {
    accountId: accountId(id),
    oldestDueAt: T0,
    publish: true,
    reconcile: true,
    metrics: true,
    ...flags,
  };
}

const readerWith = (items: readonly AccountWork[]): PostReader =>
  ({ accountsNeedingWork: () => Promise.resolve(items) }) as unknown as PostReader;

describe("publishDueTick (plan §3.3 #5, U16)", () => {
  const tick = async (
    reader: PostReader,
    publisher: AccountPublisher,
    budget = meter(),
    world = makeWorld(),
  ) => {
    const presenter = new Capture<PublishDueTickOutputData>();
    await new PublishDueTickInteractor(reader, publisher, budget, world.clock, presenter).execute({
      actor: SYSTEM_ACTOR,
    });
    return presenter.last;
  };
  const calls: string[] = [];
  const recording = (appLimitAt: string | null = null): AccountPublisher => ({
    publishDue: (account, now, deadline) => {
      calls.push(`${account}@${String(now)}<${String(deadline)}`);
      return Promise.resolve({
        ran: true,
        sent: 1,
        touched: [],
        appRateLimited: account === appLimitAt,
      });
    },
    publishNow: () => Promise.reject(new Error("unused")),
  });

  it("dispatches only accounts with publishing work, with the tick's deadline", async () => {
    calls.length = 0;
    const out = await tick(
      readerWith([work("a"), work("b", { publish: false }), work("c")]),
      recording(),
    );
    expect(out).toStrictEqual({
      job: "cron",
      dispatched: 2,
      waiting: 0,
      stoppedForAppLimit: false,
    });
    expect(calls).toStrictEqual([
      `a@${String(T0)}<${String(T0 + HOUR)}`,
      `c@${String(T0)}<${String(T0 + HOUR)}`,
    ]);
  });

  it("at most 200 accounts per invocation; the rest wait a minute", async () => {
    calls.length = 0;
    const many = Array.from({ length: 250 }, (_, index) => work(`a${String(index)}`));
    expect(await tick(readerWith(many), recording())).toStrictEqual({
      job: "cron",
      dispatched: 200,
      waiting: 50,
      stoppedForAppLimit: false,
    });
  });

  it("an app-scope 429 stops the dispatch", async () => {
    calls.length = 0;
    const out = await tick(readerWith([work("a"), work("b"), work("c")]), recording("b"));
    expect(out).toStrictEqual({ job: "cron", dispatched: 2, waiting: 1, stoppedForAppLimit: true });
  });

  it("stops when the tick's own Cloudflare-service pool is spent", async () => {
    calls.length = 0;
    const tight = new InvocationBudgetMeter({
      deadline: T0 + HOUR,
      cloudflareCalls: 0,
      externalSubrequests: 50,
    });
    expect(await tick(readerWith([work("a")]), recording(), tight)).toStrictEqual({
      job: "cron",
      dispatched: 0,
      waiting: 1,
      stoppedForAppLimit: false,
    });
  });

  it("end to end on stubs: a due post is published and an orphan recovered (R20)", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.table.rows.set(postId("due"), aPost({ id: postId("due"), publishAt: T0 - 1 }));
    world.table.rows.set(
      postId("orphan"),
      aPost({ id: postId("orphan"), lifecycle: "PUBLISHING", publishAt: T0 + DAY }),
    );
    const out = await tick(world.reader, world.accountPublisher, meter(), world);
    expect(out).toStrictEqual({
      job: "cron",
      dispatched: 1,
      waiting: 0,
      stoppedForAppLimit: false,
    });
    expect(world.table.rows.get(postId("due"))?.lifecycle).toBe("DONE");
    expect(world.table.rows.get(postId("orphan"))?.lifecycle).toBe("SCHEDULED");
  });
});

describe("reconcileTick and metricsTick", () => {
  it("reconcile dispatches accounts with an UNKNOWN part and sums the results", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.table.rows.set(
      postId("u"),
      aPost({ id: postId("u"), lifecycle: "DONE", parts: [part("gone", unknownState())] }),
    );
    const presenter = new Capture<ReconcileTickOutputData>();
    const interactor = new ReconcileTickInteractor(
      world.reader,
      world.reconciler,
      meter(),
      world.clock,
      presenter,
    );
    await interactor.execute({ actor: SYSTEM_ACTOR });
    expect(presenter.last).toStrictEqual({
      job: "cron",
      dispatched: 1,
      waiting: 0,
      found: 0,
      notFound: 1,
    });
    const fake = readerWith([work("a", { reconcile: false }), work("b")]);
    const counted: string[] = [];
    const reconciler = {
      reconcile: (account: AccountId) => {
        counted.push(account);
        return Promise.resolve({ ran: true, found: 2, notFound: 3 });
      },
    };
    await new ReconcileTickInteractor(fake, reconciler, meter(), world.clock, presenter).execute({
      actor: SYSTEM_ACTOR,
    });
    expect(presenter.last).toStrictEqual({
      job: "cron",
      dispatched: 1,
      waiting: 0,
      found: 2,
      notFound: 3,
    });
    expect(counted).toStrictEqual(["b"]);
  });

  it("metrics dispatches accounts with metrics due, then cleans up staged media", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const id = xPostId("x-1");
    world.x.posts.set(id, {
      id,
      account: ACCOUNT,
      text: "t",
      media: [],
      inReplyTo: null,
      createdAt: T0,
    });
    world.table.rows.set(
      postId("p"),
      aPost({ id: postId("p"), lifecycle: "DONE", parts: [part("t", sentState(id))] }),
    );
    await world.stage(ACCOUNT, "PHOTO", "m-unused");
    world.clock.advance(2 * DAY);
    const presenter = new Capture<MetricsTickOutputData>();
    const budget = meter(T0 + 3 * DAY);
    const interactor = new MetricsTickInteractor(
      {
        reader: world.reader,
        collector: world.collector,
        cleanup: world.cleanup,
        meter: budget,
        clock: world.clock,
      },
      presenter,
    );
    await interactor.execute({ actor: SYSTEM_ACTOR });
    expect(presenter.last).toStrictEqual({
      job: "cron",
      dispatched: 1,
      waiting: 0,
      read: 1,
      mediaDeleted: 1,
    });
    const fake = readerWith([work("a", { metrics: false }), work("b")]);
    const collector = { collect: () => Promise.resolve({ ran: true, read: 7 }) };
    const other = new MetricsTickInteractor(
      { reader: fake, collector, cleanup: world.cleanup, meter: budget, clock: world.clock },
      presenter,
    );
    await other.execute({ actor: SYSTEM_ACTOR });
    expect(presenter.last).toStrictEqual({
      job: "cron",
      dispatched: 1,
      waiting: 0,
      read: 7,
      mediaDeleted: 0,
    });
  });
});

describe("deletePost (plan §3.3 #7)", () => {
  const remove = async (world: World, actor = HUMAN) => {
    const presenter = new Capture<DeletePostOutputData>();
    const interactor = new DeletePostInteractor(
      {
        reader: world.reader,
        gateway: world.gateway,
        steps: world.steps,
        guard: world.guard,
        audit: world.actionAudit,
      },
      presenter,
    );
    await interactor.execute({ actor, postId: postId("post-1") });
    return presenter.last;
  };
  const thread = (): Post =>
    aPost({ lifecycle: "DONE", parts: [part("a", sentState("x-a")), part("b", sentState("x-b"))] });

  it("deletes every sent part, last first", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.table.rows.set(postId("post-1"), thread());
    const calls: string[] = [];
    const del = world.xPublisher.delete.bind(world.xPublisher);
    world.xPublisher.delete = (account, id) => {
      calls.push(id);
      return del(account, id);
    };
    const out = await remove(world, botActor());
    expect(out).toMatchObject({
      ok: true,
      deleted: 2,
      incomplete: false,
      post: { status: "DELETED", version: 3 },
    });
    expect(calls).toStrictEqual(["x-b", "x-a"]);
    expect(world.audit.events.map((event) => [event.action, event.detail]).at(-1)).toStrictEqual([
      "post.delete",
      "deleted 2 of 2",
    ]);
  });

  it("a failed delete leaves the rest SENT: delete incomplete, and it can be retried", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.table.rows.set(postId("post-1"), thread());
    world.x.scripts.delete.push({ kind: "ok" }, { kind: "fail", failure: { kind: "no_response" } });
    expect(await remove(world)).toMatchObject({
      ok: true,
      deleted: 1,
      incomplete: true,
      post: { status: "DELETE_INCOMPLETE" },
    });
    expect(await remove(world)).toMatchObject({
      ok: true,
      deleted: 1,
      incomplete: false,
      post: { status: "DELETED" },
    });
  });

  it("refuses: not found, scope, not deletable, and a conflict while marking", async () => {
    const world = makeWorld();
    expect(await remove(world)).toStrictEqual({ ok: false, code: "not_found" });
    await world.seedAccount();
    world.table.rows.set(postId("post-1"), thread());
    expect(await remove(world, botActor([OTHER_ACCOUNT]))).toStrictEqual({
      ok: false,
      code: "scope",
    });
    world.table.rows.set(postId("post-1"), aPost({ lifecycle: "SCHEDULED" }));
    expect(await remove(world)).toStrictEqual({ ok: false, code: "not_deletable" });
    world.table.rows.set(postId("post-1"), thread());
    world.writer.save = () => Promise.resolve({ kind: "version_conflict" });
    expect(await remove(world)).toStrictEqual({ ok: false, code: "version_conflict" });
  });

  it("system actors may delete too (cleanup jobs)", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.table.rows.set(postId("post-1"), thread());
    world.clock.advance(MINUTE);
    expect((await remove(world, SYSTEM)).ok).toBe(true);
  });
});
