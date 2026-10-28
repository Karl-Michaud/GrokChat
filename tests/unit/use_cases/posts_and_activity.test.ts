/** The posts page, a post's insights and the activity history (GROKCHAT-15). */
import { describe, expect, it } from "vitest";
import { ZERO } from "../../../src/entities/analytics/metric_values";
import type { PostSortKey, SortDirection } from "../../../src/entities/analytics/post_sort";
import { postId, xPostId } from "../../../src/entities/identity/ids";
import { DAY, HOUR } from "../../../src/entities/time/instant";
import {
  GetPostInsightsInteractor,
  TIMELINE_LIMIT,
} from "../../../src/use_cases/get_post_insights/interactor";
import type { GetPostInsightsOutputData } from "../../../src/use_cases/get_post_insights/output_data";
import { ListActivityInteractor } from "../../../src/use_cases/list_activity/interactor";
import type { ListActivityOutputData } from "../../../src/use_cases/list_activity/output_data";
import { ListPostsInteractor } from "../../../src/use_cases/list_posts/interactor";
import type { ListPostsInputData } from "../../../src/use_cases/list_posts/input_data";
import type { ListPostsOutputData } from "../../../src/use_cases/list_posts/output_data";
import {
  ACCOUNT,
  aPost,
  aSnapshot,
  botActor,
  HUMAN,
  OTHER_ACCOUNT,
  part,
  sentState,
  T0,
} from "../support/builders";
import { Capture, makeWorld, type World } from "../support/world";

async function seeded(): Promise<World> {
  const world = makeWorld();
  await world.seedAccount();
  const add = (id: string, at: number, extra: Parameters<typeof aPost>[0] = {}) =>
    world.writer.add(aPost({ id: postId(id), publishAt: at, ...extra }));
  await add("a", T0 - 3 * DAY, {
    lifecycle: "DONE",
    parts: [part("a1", sentState("xa1", T0 - 3 * DAY)), part("a2", sentState("xa2", T0 - 3 * DAY))],
  });
  await add("b", T0 - 2 * DAY, {
    lifecycle: "DONE",
    parts: [part("b", sentState("xb", T0 - 2 * DAY)), part("b2", sentState("xb2", T0 - 2 * DAY))],
  });
  await add("c", T0 - DAY, {
    accountId: OTHER_ACCOUNT,
    lifecycle: "DONE",
    parts: [part("c", sentState("xc", T0 - DAY))],
  });
  await add("d", T0 + DAY);
  await world.metrics.addSnapshots([
    aSnapshot("xa1", T0 - DAY, 10),
    aSnapshot("xa1", T0, 40),
    aSnapshot("xa2", T0, 5),
    aSnapshot("xb", T0, 300),
    aSnapshot("xc", T0, 20, { accountId: OTHER_ACCOUNT }),
  ]);
  return world;
}

async function list(world: World, input: Partial<ListPostsInputData> = {}) {
  const presenter = new Capture<ListPostsOutputData>();
  await new ListPostsInteractor(
    { reader: world.reader, metrics: world.metrics, guard: world.guard },
    presenter,
  ).execute({
    actor: HUMAN,
    accountId: null,
    statuses: null,
    window: null,
    sort: "time",
    direction: "desc",
    page: 1,
    pageSize: 50,
    ...input,
  });
  return presenter.last;
}

const ids = (out: ListPostsOutputData) => (out.ok ? out.rows.map((row) => row.post.id) : []);

describe("listPosts (GROKCHAT-15)", () => {
  it("every post, newest first, each with its parts' newest reads summed (null when never read)", async () => {
    const out = await list(await seeded());
    expect(ids(out)).toStrictEqual(["d", "c", "b", "a"]);
    if (!out.ok) {
      throw new Error("refused");
    }
    expect(out.rows.map((row) => row.metrics?.impressions ?? null)).toStrictEqual([
      null,
      20,
      300,
      45,
    ]);
    expect(out.rows[3]?.metrics).toStrictEqual({
      ...ZERO,
      impressions: 45,
      likes: 4,
      bookmarks: 1,
    });
    expect([out.total, out.page, out.pages]).toStrictEqual([4, 1, 1]);
  });

  it.each<[PostSortKey, SortDirection, readonly string[]]>([
    ["impressions", "desc", ["b", "a", "c", "d"]],
    ["impressions", "asc", ["c", "a", "b", "d"]],
    ["time", "asc", ["a", "b", "c", "d"]],
  ])("sorts by %s %s", async (sort, direction, expected) => {
    expect(ids(await list(await seeded(), { sort, direction }))).toStrictEqual(expected);
  });

  it("filters by account, status and publish window, and pages", async () => {
    const world = await seeded();
    expect(ids(await list(world, { accountId: OTHER_ACCOUNT }))).toStrictEqual(["c"]);
    expect(ids(await list(world, { statuses: ["SCHEDULED"] }))).toStrictEqual(["d"]);
    expect(ids(await list(world, { window: { from: T0 - 2 * DAY, to: T0 } }))).toStrictEqual([
      "c",
      "b",
    ]);
    const second = await list(world, { pageSize: 3, page: 2 });
    expect([ids(second), second.ok && second.total, second.ok && second.pages]).toStrictEqual([
      ["a"],
      4,
      2,
    ]);
  });

  it("refuses a bot, audited", async () => {
    const world = await seeded();
    expect(await list(world, { actor: botActor() })).toStrictEqual({
      ok: false,
      code: "human_only",
    });
    expect(world.audit.events.map((e) => e.action)).toStrictEqual(["refused.post.list"]);
  });
});

describe("getPostInsights (GROKCHAT-15)", () => {
  const insights = async (world: World, id: string, actor = HUMAN) => {
    const presenter = new Capture<GetPostInsightsOutputData>();
    const { reader, metrics, activity, guard } = world;
    await new GetPostInsightsInteractor({ reader, metrics, activity, guard }, presenter).execute({
      actor,
      postId: postId(id),
    });
    return presenter.last;
  };

  it("the post, every read of its parts, and its history oldest first, with costs", async () => {
    const world = await seeded();
    await world.audit.append({
      at: T0 - 3 * DAY,
      actor: "bot:bot-1",
      action: "post.create",
      accountId: ACCOUNT,
      postId: postId("a"),
      detail: "",
    });
    await world.audit.append({
      at: T0 - 3 * DAY,
      actor: "bot:bot-1",
      action: "post.create",
      accountId: ACCOUNT,
      postId: postId("b"),
      detail: "",
    });
    await world.recorder.record({
      account: { id: ACCOUNT },
      operation: { kind: "create", text: "a1" },
      billed: true,
      outcome: "sent",
      postId: postId("a"),
      at: T0 - 3 * DAY + HOUR,
    });
    const out = await insights(world, "a");
    if (!out.ok) {
      throw new Error(out.code);
    }
    expect(out.post.id).toBe("a");
    expect(out.series.map((s) => [s.xPostId, s.impressions])).toStrictEqual([
      [xPostId("xa1"), 10],
      [xPostId("xa1"), 40],
      [xPostId("xa2"), 5],
    ]);
    expect(out.timeline.map((e) => [e.action, e.cost])).toStrictEqual([
      ["post.create", null],
      ["x.create", { kind: "usd", micros: 15_000 }],
    ]);
    expect(TIMELINE_LIMIT).toBe(200);
  });

  it("refuses an unknown post and one outside a bot's scope", async () => {
    const world = await seeded();
    expect(await insights(world, "nope")).toStrictEqual({ ok: false, code: "not_found" });
    expect(await insights(world, "c", botActor([ACCOUNT]))).toStrictEqual({
      ok: false,
      code: "scope",
    });
    expect(world.audit.events.map((e) => e.action)).toStrictEqual(["refused.post.insights"]);
    expect((await insights(world, "c", botActor([OTHER_ACCOUNT]))).ok).toBe(true);
  });
});

describe("listActivity (GROKCHAT-15)", () => {
  const activity = async (world: World, page: number, actor = HUMAN, size = 2) => {
    const presenter = new Capture<ListActivityOutputData>();
    await new ListActivityInteractor(world.activity, world.guard, presenter).execute({
      actor,
      filter: { accountId: ACCOUNT },
      page,
      pageSize: size,
    });
    return presenter.last;
  };

  it("pages the history newest first", async () => {
    const world = makeWorld();
    for (const at of [T0, T0 + 1, T0 + 2]) {
      await world.audit.append({
        at,
        actor: "human:admin",
        action: "post.edit",
        accountId: ACCOUNT,
        postId: null,
        detail: "",
      });
    }
    await world.audit.append({
      at: T0 + 3,
      actor: "human:admin",
      action: "post.edit",
      accountId: OTHER_ACCOUNT,
      postId: null,
      detail: "",
    });
    expect(await activity(world, 1)).toMatchObject({
      ok: true,
      total: 3,
      page: 1,
      pages: 2,
      entries: [{ at: T0 + 2 }, { at: T0 + 1 }],
    });
    expect(await activity(world, 2)).toMatchObject({ page: 2, entries: [{ at: T0 }] });
    expect(await activity(world, 0)).toMatchObject({ page: 1 });
    expect(await activity(makeWorld(), 1)).toMatchObject({ total: 0, pages: 1, entries: [] });
  });

  it("refuses a bot, audited", async () => {
    const world = makeWorld();
    expect(await activity(world, 1, botActor())).toStrictEqual({ ok: false, code: "human_only" });
    expect(world.audit.events.map((e) => e.action)).toStrictEqual(["refused.activity.list"]);
  });
});
