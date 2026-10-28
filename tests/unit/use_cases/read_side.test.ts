import { describe, expect, it } from "vitest";
import { accountId, postId, stagedMediaId, xPostId } from "../../../src/entities/identity/ids";
import { PENDING } from "../../../src/entities/posts/part_state";
import type { MetricsSnapshot } from "../../../src/entities/metrics/metrics_snapshot";
import { DAY, HOUR } from "../../../src/entities/time/instant";
import { AuditListInteractor } from "../../../src/use_cases/audit_list/interactor";
import type { AuditListOutputData } from "../../../src/use_cases/audit_list/output_data";
import { ComparePostsInteractor } from "../../../src/use_cases/compare_posts/interactor";
import type { ComparePostsOutputData } from "../../../src/use_cases/compare_posts/output_data";
import { CostTotalsInteractor } from "../../../src/use_cases/cost_totals/interactor";
import type { CostTotalsOutputData } from "../../../src/use_cases/cost_totals/output_data";
import { GetAccountMetricsInteractor } from "../../../src/use_cases/get_account_metrics/interactor";
import type { GetAccountMetricsOutputData } from "../../../src/use_cases/get_account_metrics/output_data";
import { GetCalendarInteractor } from "../../../src/use_cases/get_calendar/interactor";
import type { GetCalendarOutputData } from "../../../src/use_cases/get_calendar/output_data";
import { GetPolicyInteractor } from "../../../src/use_cases/get_policy/interactor";
import type { GetPolicyOutputData } from "../../../src/use_cases/get_policy/output_data";
import { GetPostInteractor } from "../../../src/use_cases/get_post/interactor";
import type { GetPostOutputData } from "../../../src/use_cases/get_post/output_data";
import { GetPostMetricsInteractor } from "../../../src/use_cases/get_post_metrics/interactor";
import type { GetPostMetricsOutputData } from "../../../src/use_cases/get_post_metrics/output_data";
import { ListBacklogInteractor } from "../../../src/use_cases/list_backlog/interactor";
import type { ListBacklogInputData } from "../../../src/use_cases/list_backlog/input_data";
import type { ListBacklogOutputData } from "../../../src/use_cases/list_backlog/output_data";
import { toPostView } from "../../../src/use_cases/views/post_view";
import {
  ACCOUNT,
  aPost,
  botActor,
  HUMAN,
  OTHER_ACCOUNT,
  part,
  sentState,
  T0,
} from "../support/builders";
import { Capture, makeWorld, type World } from "../support/world";
import { required } from "../support/publishing";

const WINDOW = { from: T0 - DAY, to: T0 + DAY };

function snapshot(id: string, takenAt: number, likes: number, account = ACCOUNT): MetricsSnapshot {
  return {
    xPostId: xPostId(id),
    accountId: account,
    takenAt,
    impressions: likes * 10,
    likes,
    reposts: 1,
    replies: 2,
    quotes: 3,
    bookmarks: 4,
    urlLinkClicks: null,
    userProfileClicks: null,
  };
}

async function populated(): Promise<World> {
  const world = makeWorld();
  await world.seedAccount();
  await world.seedAccount({ id: OTHER_ACCOUNT, xUserId: "x-user-2" as never });
  world.table.rows.set(postId("a1"), aPost({ id: postId("a1"), publishAt: T0 }));
  world.table.rows.set(
    postId("a2"),
    aPost({
      id: postId("a2"),
      lifecycle: "DONE",
      publishAt: T0 - HOUR,
      parts: [part("p", sentState("x-a2"))],
    }),
  );
  world.table.rows.set(
    postId("b1"),
    aPost({ id: postId("b1"), accountId: OTHER_ACCOUNT, publishAt: T0 + 2 * DAY }),
  );
  return world;
}

describe("getPost", () => {
  it("returns the view in scope; refuses an unknown post and another account's", async () => {
    const world = await populated();
    const presenter = new Capture<GetPostOutputData>();
    const get = new GetPostInteractor(world.reader, world.guard, presenter);
    await get.execute({ actor: botActor(), postId: postId("a1") });
    expect(presenter.last).toStrictEqual({
      ok: true,
      post: toPostView(required(world.table.rows.get(postId("a1")))),
    });
    await get.execute({ actor: botActor(), postId: postId("b1") });
    expect(presenter.last).toStrictEqual({ ok: false, code: "scope" });
    await get.execute({ actor: botActor(), postId: postId("zz") });
    expect(presenter.last).toStrictEqual({ ok: false, code: "not_found" });
  });

  it("the view shows X ids of sent and deleted parts only, and never the request hash", () => {
    const view = toPostView(
      aPost({
        parts: [
          part("a", sentState("x-1")),
          part("b", { kind: "DELETED", xPostId: xPostId("x-2") }),
          part("c", PENDING, [stagedMediaId("m-1")]),
        ],
      }),
    );
    expect(view.parts).toStrictEqual([
      { text: "a", media: [], state: "SENT", xPostId: xPostId("x-1") },
      { text: "b", media: [], state: "DELETED", xPostId: xPostId("x-2") },
      { text: "c", media: [stagedMediaId("m-1")], state: "PENDING", xPostId: null },
    ]);
    expect(JSON.stringify(view)).not.toContain("hash-1");
  });
});

describe("listBacklog and getCalendar", () => {
  const list = async (world: World, input: Partial<ListBacklogInputData>) => {
    const presenter = new Capture<ListBacklogOutputData>();
    await new ListBacklogInteractor(world.reader, world.guard, presenter).execute({
      actor: HUMAN,
      accountId: null,
      statuses: null,
      window: null,
      ...input,
    });
    return presenter.last;
  };
  const ids = (out: ListBacklogOutputData | GetCalendarOutputData): readonly string[] =>
    out.ok ? out.posts.map((post) => post.id) : [];

  it("a bot sees its scope; a human sees everything; filters by account, status and window", async () => {
    const world = await populated();
    expect(ids(await list(world, { actor: botActor() }))).toStrictEqual(["a2", "a1"]);
    expect(ids(await list(world, {}))).toStrictEqual(["a2", "a1", "b1"]);
    expect(ids(await list(world, { accountId: OTHER_ACCOUNT }))).toStrictEqual(["b1"]);
    expect(ids(await list(world, { statuses: ["PUBLISHED"] }))).toStrictEqual(["a2"]);
    expect(ids(await list(world, { window: WINDOW }))).toStrictEqual(["a2", "a1"]);
  });

  it("a bot asking for another account is refused", async () => {
    const world = await populated();
    expect(await list(world, { actor: botActor(), accountId: OTHER_ACCOUNT })).toStrictEqual({
      ok: false,
      code: "scope",
    });
  });

  it("the calendar is for humans, across accounts, by window", async () => {
    const world = await populated();
    const presenter = new Capture<GetCalendarOutputData>();
    const calendar = new GetCalendarInteractor(world.reader, world.guard, presenter);
    await calendar.execute({ actor: HUMAN, window: { from: T0 - DAY, to: T0 + 3 * DAY } });
    expect(ids(presenter.last)).toStrictEqual(["a2", "a1", "b1"]);
    await calendar.execute({ actor: botActor(), window: WINDOW });
    expect(presenter.last).toStrictEqual({ ok: false, code: "human_only" });
  });
});

describe("metrics reads", () => {
  it("getPostMetrics: the newest snapshot of each sent part", async () => {
    const world = await populated();
    await world.metrics.addSnapshots([
      snapshot("x-a2", T0, 1),
      snapshot("x-a2", T0 + HOUR, 5),
      snapshot("x-zz", T0, 9),
    ]);
    const presenter = new Capture<GetPostMetricsOutputData>();
    const get = new GetPostMetricsInteractor(world.reader, world.metrics, world.guard, presenter);
    await get.execute({ actor: botActor(), postId: postId("a2") });
    expect(presenter.last).toStrictEqual({
      ok: true,
      postId: postId("a2"),
      parts: [snapshot("x-a2", T0 + HOUR, 5)],
    });
    await get.execute({ actor: botActor(), postId: postId("b1") });
    expect(presenter.last).toStrictEqual({ ok: false, code: "scope" });
    await get.execute({ actor: HUMAN, postId: postId("zz") });
    expect(presenter.last).toStrictEqual({ ok: false, code: "not_found" });
  });

  it("getPostMetrics skips parts that were never sent", async () => {
    const world = await populated();
    world.table.rows.set(
      postId("t"),
      aPost({
        id: postId("t"),
        lifecycle: "DONE",
        parts: [part("a", sentState("x-t")), part("b")],
      }),
    );
    await world.metrics.addSnapshots([snapshot("x-t", T0, 3)]);
    const presenter = new Capture<GetPostMetricsOutputData>();
    await new GetPostMetricsInteractor(world.reader, world.metrics, world.guard, presenter).execute(
      {
        actor: HUMAN,
        postId: postId("t"),
      },
    );
    expect(presenter.last).toStrictEqual({
      ok: true,
      postId: postId("t"),
      parts: [snapshot("x-t", T0, 3)],
    });
  });

  it("getAccountMetrics: totals over each post's newest snapshot in the window", async () => {
    const world = await populated();
    await world.metrics.addSnapshots([
      snapshot("x-1", T0, 1),
      snapshot("x-1", T0 + HOUR, 2),
      snapshot("x-2", T0, 10),
      snapshot("x-3", T0 + 2 * DAY, 100),
      snapshot("x-9", T0, 1000, OTHER_ACCOUNT),
    ]);
    const presenter = new Capture<GetAccountMetricsOutputData>();
    const get = new GetAccountMetricsInteractor(world.metrics, world.guard, presenter);
    await get.execute({ actor: botActor(), accountId: ACCOUNT, window: WINDOW });
    expect(presenter.last).toStrictEqual({
      ok: true,
      accountId: ACCOUNT,
      posts: 2,
      totals: { impressions: 120, likes: 12, reposts: 2, replies: 4, quotes: 6, bookmarks: 8 },
      series: [snapshot("x-1", T0, 1), snapshot("x-2", T0, 10), snapshot("x-1", T0 + HOUR, 2)],
    });
    await get.execute({ actor: botActor(), accountId: OTHER_ACCOUNT, window: WINDOW });
    expect(presenter.last).toStrictEqual({ ok: false, code: "scope" });
  });

  it("comparePosts ranks newest snapshots by the chosen metric, ties by id", async () => {
    const world = await populated();
    await world.metrics.addSnapshots([
      snapshot("x-b", T0, 5),
      snapshot("x-a", T0, 5),
      snapshot("x-c", T0, 9),
    ]);
    const presenter = new Capture<ComparePostsOutputData>();
    const compare = new ComparePostsInteractor(world.metrics, world.guard, presenter);
    await compare.execute({
      actor: botActor(),
      accountId: ACCOUNT,
      window: WINDOW,
      sortBy: "likes",
    });
    expect(presenter.last).toStrictEqual({
      ok: true,
      ranked: [snapshot("x-c", T0, 9), snapshot("x-a", T0, 5), snapshot("x-b", T0, 5)],
    });
    await compare.execute({
      actor: botActor(),
      accountId: OTHER_ACCOUNT,
      window: WINDOW,
      sortBy: "likes",
    });
    expect(presenter.last).toStrictEqual({ ok: false, code: "scope" });
  });
});

describe("policy, costs and audit", () => {
  it("getPolicy for an account in scope", async () => {
    const world = await populated();
    const policy = new Capture<GetPolicyOutputData>();
    const getPolicy = new GetPolicyInteractor(world.accounts, world.guard, policy);
    await getPolicy.execute({ actor: botActor(), accountId: ACCOUNT });
    const account = required(await world.accounts.get(ACCOUNT));
    expect(policy.last).toStrictEqual({
      ok: true,
      accountId: ACCOUNT,
      handle: account.handle,
      status: "ACTIVE",
      disclosure: account.disclosure,
      policy: account.policy,
    });
    await getPolicy.execute({ actor: botActor(), accountId: OTHER_ACCOUNT });
    expect(policy.last).toStrictEqual({ ok: false, code: "scope" });
    await getPolicy.execute({ actor: HUMAN, accountId: accountId("zz") });
    expect(policy.last).toStrictEqual({ ok: false, code: "not_found" });
  });

  it("costTotals and auditList are human only", async () => {
    const world = await populated();
    await world.costs.append({
      at: T0,
      accountId: ACCOUNT,
      operation: "create",
      estimate: { kind: "usd", micros: 15_000 },
    });
    await world.costs.append({
      at: T0,
      accountId: OTHER_ACCOUNT,
      operation: "read",
      estimate: { kind: "unknown" },
    });
    const costs = new Capture<CostTotalsOutputData>();
    const totals = new CostTotalsInteractor(world.costs, world.guard, costs);
    await totals.execute({ actor: HUMAN, window: WINDOW, accountId: null });
    expect(costs.last).toStrictEqual({
      ok: true,
      totals: { micros: 15_000, calls: 2, unknownPriced: 1 },
    });
    await totals.execute({ actor: HUMAN, window: WINDOW, accountId: ACCOUNT });
    expect(costs.last).toStrictEqual({
      ok: true,
      totals: { micros: 15_000, calls: 1, unknownPriced: 0 },
    });
    await totals.execute({ actor: botActor(), window: WINDOW, accountId: null });
    expect(costs.last).toStrictEqual({ ok: false, code: "human_only" });

    const audit = new Capture<AuditListOutputData>();
    const listAudit = new AuditListInteractor(world.audit, world.guard, audit);
    await listAudit.execute({ actor: botActor(), filter: {} });
    expect(audit.last).toStrictEqual({ ok: false, code: "human_only" });
    await listAudit.execute({ actor: HUMAN, filter: { limit: 1 } });
    expect(audit.last).toMatchObject({
      ok: true,
      events: [{ action: "refused.audit.list", detail: "human_only" }],
    });
  });
});
