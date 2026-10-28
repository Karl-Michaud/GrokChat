/** The dashboard's read models (GROKCHAT-15): analytics, posts, a post's insights, activity. */
import { describe, expect, it } from "vitest";
import { ZERO } from "../../../src/entities/analytics/metric_values";
import { accountId, postId, xPostId, xUserId } from "../../../src/entities/identity/ids";
import { DAY, HOUR, MINUTE } from "../../../src/entities/time/instant";
import { GetAnalyticsInteractor, TOP_POSTS } from "../../../src/use_cases/get_analytics/interactor";
import type { GetAnalyticsInputData } from "../../../src/use_cases/get_analytics/input_data";
import type { GetAnalyticsOutputData } from "../../../src/use_cases/get_analytics/output_data";
import {
  aFollowerSnapshot,
  aPost,
  aSnapshot,
  botActor,
  HUMAN,
  OTHER_ACCOUNT,
  part,
  sentState,
  ACCOUNT,
  T0,
} from "../support/builders";
import { Capture, makeWorld, type World } from "../support/world";

async function analytics(world: World, input: Partial<GetAnalyticsInputData> = {}) {
  const presenter = new Capture<GetAnalyticsOutputData>();
  const { accounts, reader, metrics, followers, costs, guard, clock } = world;
  await new GetAnalyticsInteractor(
    { accounts, reader, metrics, followers, costs, guard, clock },
    presenter,
  ).execute({ actor: HUMAN, range: "7d", accountId: null, ...input });
  const out = presenter.last;
  if (!out.ok) {
    throw new Error(out.code);
  }
  return out;
}

async function record(world: World, at: number, count: number, account = ACCOUNT) {
  const snapshot = aFollowerSnapshot(at, count, account);
  await world.followers.claim(account, snapshot.day, at);
  await world.followers.record(snapshot);
}

/** Two accounts: one post each published in the range, one before; metrics, followers, costs. */
async function populated(): Promise<World> {
  const world = makeWorld();
  await world.seedAccount();
  await world.seedAccount({ id: OTHER_ACCOUNT, xUserId: xUserId("x-user-2"), handle: "two" });
  const sent = (id: string, account: typeof ACCOUNT, xId: string, at: number) =>
    world.writer.add(
      aPost({
        id: postId(id),
        accountId: account,
        lifecycle: "DONE",
        parts: [part(id, sentState(xId, at))],
      }),
    );
  await sent("p-old", ACCOUNT, "x-old", T0 - 10 * DAY);
  await sent("p-one", ACCOUNT, "x-one", T0 - 2 * DAY);
  await sent("p-two", OTHER_ACCOUNT, "x-two", T0 - DAY);
  await world.writer.add(aPost({ id: postId("p-waiting") }));
  await world.metrics.addSnapshots([
    aSnapshot("x-old", T0 - 9 * DAY, 500),
    aSnapshot("x-old", T0 - DAY, 600),
    aSnapshot("x-one", T0 - 2 * DAY + HOUR, 100),
    aSnapshot("x-one", T0 - HOUR, 300),
    aSnapshot("x-two", T0 - DAY + HOUR, 1000, { accountId: OTHER_ACCOUNT }),
  ]);
  await record(world, T0 - 9 * DAY, 90);
  await record(world, T0 - 3 * DAY, 100);
  await record(world, T0 - HOUR, 130);
  await record(world, T0 - DAY, 40, OTHER_ACCOUNT);
  for (const [at, micros, account] of [
    [T0 - 9 * DAY, 5_000, ACCOUNT],
    [T0 - DAY, 15_000, ACCOUNT],
    [T0 - DAY, 10_000, OTHER_ACCOUNT],
  ] as const) {
    await world.costs.append({
      at,
      accountId: account,
      operation: "read",
      estimate: { kind: "usd", micros },
    });
  }
  return world;
}

describe("getAnalytics (GROKCHAT-15)", () => {
  it("totals the range against the period before, for every account", async () => {
    const out = await analytics(await populated());
    expect(out.range.range).toBe("7d");
    // x-old 600-500, x-one 300 (its first read counts from 0), x-two 1000.
    expect(out.current.values.impressions).toBe(100 + 300 + 1000);
    expect(out.current.published).toBe(2);
    // Account 1: its newest in the range (130) minus its newest before it (day -9: 90).
    expect(out.current.growth).toBe(130 - 90 + 0);
    expect(out.current.spend).toStrictEqual({ micros: 25_000, calls: 2, unknownPriced: 0 });
    expect(out.previous).toMatchObject({ published: 1, spend: { micros: 5_000 } });
    expect(out.previous?.values.impressions).toBe(500);
    expect(out.followers).toBe(170);
    expect(out.buckets).toHaveLength(7);
    expect(out.buckets.reduce((total, b) => total + b.values.impressions, 0)).toBe(1400);
  });

  it("breaks the range down per account, and ranks the top posts", async () => {
    const out = await analytics(await populated());
    expect(
      out.accounts.map((a) => [
        a.accountId,
        a.values.impressions,
        a.published,
        a.followers,
        a.growth,
        a.spend.micros,
      ]),
    ).toStrictEqual([
      [ACCOUNT, 400, 1, 130, 40, 15_000],
      [OTHER_ACCOUNT, 1000, 1, 40, 0, 10_000],
    ]);
    expect(out.topPosts.map((p) => p.postId)).toStrictEqual([
      postId("p-two"),
      postId("p-one"),
      postId("p-old"),
    ]);
    expect(TOP_POSTS).toBe(5);
  });

  it("one account: its own numbers and spend only", async () => {
    const out = await analytics(await populated(), { accountId: OTHER_ACCOUNT });
    expect(out.accounts.map((a) => a.accountId)).toStrictEqual([OTHER_ACCOUNT]);
    expect(out.current).toMatchObject({ published: 1, spend: { micros: 10_000 } });
    expect(out.current.values.impressions).toBe(1000);
    expect(out.topPosts.map((p) => p.postId)).toStrictEqual([postId("p-two")]);
    expect(out.followers).toBe(40);
  });

  it("all time starts at the earliest data and has no previous period", async () => {
    const world = await populated();
    const removed = { kind: "DELETED", xPostId: xPostId("x-gone") } as const;
    await world.writer.add(
      aPost({ id: postId("p-gone"), lifecycle: "DONE", parts: [part("gone", removed)] }),
    );
    const out = await analytics(world, { range: "all" });
    expect(out.range.window.from).toBe(Math.floor((T0 - 10 * DAY) / DAY) * DAY);
    expect(out.previous).toBeNull();
    expect(out.current.values.impressions).toBe(600 + 300 + 1000);
    expect(out.current.published).toBe(3);
    expect(out.range.starts).toHaveLength(11);
  });

  it("an empty dashboard is all zeros, today only, with no followers known", async () => {
    const out = await analytics(makeWorld(), { range: "all" });
    expect(out.current).toStrictEqual({
      values: ZERO,
      published: 0,
      growth: 0,
      spend: { micros: 0, calls: 0, unknownPriced: 0 },
    });
    expect([out.followers, out.accounts, out.topPosts, out.range.starts.length]).toStrictEqual([
      null,
      [],
      [],
      1,
    ]);
    const hourly = await analytics(makeWorld(), { range: "24h" });
    expect(hourly.buckets).toHaveLength(24);
  });

  it("refuses a bot (audited) and an unknown account", async () => {
    const world = await populated();
    const presenter = new Capture<GetAnalyticsOutputData>();
    const { accounts, reader, metrics, followers, costs, guard, clock } = world;
    const interactor = new GetAnalyticsInteractor(
      { accounts, reader, metrics, followers, costs, guard, clock },
      presenter,
    );
    await interactor.execute({ actor: botActor(), range: "7d", accountId: null });
    expect(presenter.last).toStrictEqual({ ok: false, code: "human_only" });
    expect(world.audit.events.map((e) => e.action)).toStrictEqual(["refused.analytics.get"]);
    await interactor.execute({ actor: HUMAN, range: "7d", accountId: accountId("nope") });
    expect(presenter.last).toStrictEqual({ ok: false, code: "not_found" });
  });

  it("the period before compares a same-length slice", async () => {
    const world = await populated();
    world.clock.advance(30 * MINUTE);
    const out = await analytics(world, { range: "24h" });
    const length = out.range.window.to - out.range.window.from;
    expect(out.range.previous).toStrictEqual({
      from: out.range.window.from - length,
      to: out.range.window.from,
    });
  });
});
