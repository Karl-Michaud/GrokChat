import { describe, expect, it } from "vitest";
import { postId, xUserId } from "../../../../src/entities/identity/ids";
import { DAY, HOUR } from "../../../../src/entities/time/instant";
import { AnalyticsController } from "../../../../src/interface_adapters/dashboard/analytics_controller";
import {
  bucketLabel,
  kpis,
  metricValue,
} from "../../../../src/interface_adapters/dashboard/analytics_views";
import { rangeWindow } from "../../../../src/entities/analytics/range";
import { ZERO } from "../../../../src/entities/analytics/metric_values";
import {
  ACCOUNT,
  aFollowerSnapshot,
  aPost,
  aSnapshot,
  OTHER_ACCOUNT,
  part,
  sentState,
  T0,
} from "../../support/builders";
import { dashboardUseCases, presenting } from "../../support/dashboard";
import { makeWorld, type World } from "../../support/world";

async function populated(): Promise<World> {
  const world = makeWorld();
  await world.seedAccount();
  await world.seedAccount({ id: OTHER_ACCOUNT, xUserId: xUserId("x-2"), handle: "second" });
  await world.writer.add(
    aPost({
      id: postId("p1"),
      lifecycle: "DONE",
      parts: [part("hello world", sentState("x1", T0 - DAY))],
    }),
  );
  await world.metrics.addSnapshots([
    aSnapshot("x1", T0 - DAY + HOUR, 1_000),
    aSnapshot("x1", T0 - HOUR, 2_500),
  ]);
  for (const [at, count] of [
    [T0 - 10 * DAY, 90],
    [T0 - HOUR, 120],
  ] as const) {
    const snapshot = aFollowerSnapshot(at, count);
    await world.followers.claim(ACCOUNT, snapshot.day, at);
    await world.followers.record(snapshot);
  }
  await world.costs.append({
    at: T0 - HOUR,
    accountId: ACCOUNT,
    operation: "read",
    estimate: { kind: "usd", micros: 5_000 },
  });
  return world;
}

const controller = (world: World) => new AnalyticsController(dashboardUseCases(world));
const query = (overrides = {}) => ({ range: null, metric: null, account: null, ...overrides });

describe("the analytics page (GROKCHAT-15)", () => {
  it("defaults to the last 7 days of impressions over every account", async () => {
    const outcome = await controller(await populated()).analytics(query());
    if (outcome.kind !== "page") {
      throw new Error(outcome.kind);
    }
    const view = outcome.view;
    expect([
      view.range,
      view.metric,
      view.rangeLabel,
      view.compared,
      view.metricLabel,
    ]).toStrictEqual(["7d", "impressions", "Last 7 days", "vs the 7 days before", "Impressions"]);
    expect(view.account).toBeNull();
    expect(view.ranges.map((tab) => [tab.label, tab.current])).toStrictEqual([
      ["24h", false],
      ["3d", false],
      ["7d", true],
      ["14d", false],
      ["30d", false],
      ["All", false],
    ]);
    expect(view.ranges[0]?.href).toBe("/dashboard/analytics?range=24h&metric=impressions");
    expect(view.metrics.map((tab) => tab.label)).toStrictEqual([
      "Impressions",
      "Engagements",
      "Likes",
      "Reposts",
      "Replies",
      "Link clicks",
    ]);
    expect(view.metrics[2]?.href).toBe("/dashboard/analytics?range=7d&metric=likes");
    expect(view.kpis.headline[0]).toMatchObject({
      label: "Impressions",
      value: "2.5K",
      exact: "2,500",
      delta: { text: "new", direction: "up" },
      polarity: "up-is-good",
    });
    expect(view.kpis.headline[0]?.spark).toMatch(/^M0 \d/);
    expect(view.kpis.secondary.map((tile) => tile.spark)).toStrictEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(view.chart.columns).toHaveLength(7);
    expect(view.chart.columns.at(-1)).toMatchObject({ label: "Oct 27", value: "1,500" });
    expect([view.followersNow, view.followerGrowth]).toStrictEqual(["120", "+30"]);
    expect(view.comparison.map((row) => [row.label, row.value])).toStrictEqual([
      ["@musechat_one", "2.5K"],
      ["@second", "0"],
    ]);
    expect(view.accountRows[0]).toStrictEqual({
      account: { id: "acc-1", handle: "@musechat_one", initials: "MO", tone: 1 },
      href: "/dashboard/analytics?range=7d&metric=impressions&account=acc-1",
      impressions: "2.5K",
      engagements: "425",
      rate: "17.0%",
      published: "1",
      followers: "120",
      growth: "+30",
      spend: "$0.005",
    });
    expect(view.accountRows[1]).toMatchObject({ rate: "—", followers: "—", growth: "0" });
    expect(view.topPosts).toStrictEqual([
      {
        href: "/dashboard/posts/p1",
        text: "hello world",
        account: view.accountRows[0]?.account,
        impressions: "2.5K",
        engagements: "425",
        rate: "17.0%",
        xUrl: "https://x.com/musechat_one/status/x1",
      },
    ]);
    expect(view.spend).toStrictEqual({ total: "$0.005", calls: "1", unknownPriced: 0 });
    expect(view.spendByAccount.map((row) => row.label)).toStrictEqual(["@musechat_one", "@second"]);
    expect(view.media.map((row) => row.name)).toStrictEqual([
      "Storage",
      "Writes (Class A)",
      "Reads (Class B)",
    ]);
    expect(view.mediaMonth).toBe("2026-10");
    expect(view.accounts.map((option) => option.selected)).toStrictEqual([false, false]);
  });

  it("one account, another range and metric", async () => {
    const outcome = await controller(await populated()).analytics(
      query({ range: "24h", metric: "likes", account: "acc-1" }),
    );
    expect(outcome).toMatchObject({
      kind: "page",
      view: {
        range: "24h",
        metric: "likes",
        compared: "vs the 24 hours before",
        metricLabel: "Likes",
        account: { handle: "@musechat_one" },
      },
    });
    if (outcome.kind === "page") {
      expect(outcome.view.chart.columns).toHaveLength(24);
      expect(outcome.view.chart.columns.at(-1)?.label).toBe("Oct 27 12:00");
      expect(outcome.view.accounts.map((option) => option.selected)).toStrictEqual([true, false]);
    }
    const all = await controller(await populated()).analytics(query({ range: "all" }));
    expect(all).toMatchObject({ view: { rangeLabel: "All time", compared: null } });
  });

  it("names every range and the period it compares with; marks the chosen metric", async () => {
    const world = await populated();
    const seen: (readonly [string, string | null])[] = [];
    for (const range of ["24h", "3d", "7d", "14d", "30d", "all"]) {
      const outcome = await controller(world).analytics(query({ range, metric: "replies" }));
      if (outcome.kind === "page") {
        seen.push([outcome.view.rangeLabel, outcome.view.compared]);
        expect(outcome.view.metrics.map((tab) => tab.current)).toStrictEqual([
          false,
          false,
          false,
          false,
          true,
          false,
        ]);
      }
    }
    expect(seen).toStrictEqual([
      ["Last 24 hours", "vs the 24 hours before"],
      ["Last 3 days", "vs the 3 days before"],
      ["Last 7 days", "vs the 7 days before"],
      ["Last 14 days", "vs the 14 days before"],
      ["Last 30 days", "vs the 30 days before"],
      ["All time", null],
    ]);
  });

  it("follower chart: fitted to the counts, by bucket; a dash before any read", async () => {
    const outcome = await controller(await populated()).analytics(query());
    if (outcome.kind === "page") {
      expect(outcome.view.followers.ticks.at(-1)).not.toBe("0");
      expect(outcome.view.followers.columns.map((column) => column.label)).toStrictEqual([
        "Oct 21",
        "Oct 22",
        "Oct 23",
        "Oct 24",
        "Oct 25",
        "Oct 26",
        "Oct 27",
      ]);
      expect(outcome.view.followers.columns.map((column) => column.value)).toStrictEqual([
        "90",
        "90",
        "90",
        "90",
        "90",
        "90",
        "120",
      ]);
    }
    const empty = makeWorld();
    await empty.seedAccount();
    expect(await controller(empty).analytics(query())).toMatchObject({
      view: { followersNow: "—", followerGrowth: "0" },
    });
  });

  it("refuses an unknown range or metric, and shows the use case's refusal", async () => {
    const world = await populated();
    expect(await controller(world).analytics(query({ range: "1y" }))).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "Unknown range or metric.",
    });
    expect(await controller(world).analytics(query({ metric: "views" }))).toMatchObject({
      status: 400,
    });
    expect(await controller(world).analytics(query({ account: "nope" }))).toMatchObject({
      kind: "refused",
      status: 404,
    });
  });

  it("without R2 usage, the meters are left out", async () => {
    const world = await populated();
    const refusing = new AnalyticsController({
      ...dashboardUseCases(world),
      mediaUsage: presenting({ ok: false, code: "human_only" }),
    });
    expect(await refusing.analytics(query())).toMatchObject({
      view: { media: [], mediaMonth: "" },
    });
  });
});

describe("analytics view pieces", () => {
  it("KPIs: every metric, growth, posts and spend, spend going up being bad", () => {
    const current = {
      values: { ...ZERO, impressions: 200, likes: 10 },
      published: 3,
      growth: 5,
      spend: { micros: 30_000, calls: 2, unknownPriced: 0 },
    };
    const previous = {
      ...current,
      values: { ...ZERO, impressions: 100, likes: 10 },
      published: 4,
      growth: 0,
      spend: { micros: 15_000, calls: 1, unknownPriced: 0 },
    };
    const buckets = [
      { start: T0, values: { ...ZERO, impressions: 50 }, followers: null, published: 1 },
      { start: T0 + DAY, values: { ...ZERO, impressions: 150 }, followers: 10, published: 2 },
    ];
    const tiles = kpis(current, previous, buckets);
    const row = (tile: (typeof tiles.headline)[number]) => [
      tile.label,
      tile.value,
      tile.delta?.text,
      tile.polarity,
    ];
    expect(tiles.headline.map(row)).toStrictEqual([
      ["Impressions", "200", "+100%", "up-is-good"],
      ["Engagements", "10", "0%", "up-is-good"],
      ["Follower growth", "+5", "new", "up-is-good"],
      ["Posts published", "3", "−25%", "up-is-good"],
    ]);
    expect(tiles.secondary.map(row)).toStrictEqual([
      ["Likes", "10", "0%", "up-is-good"],
      ["Reposts", "0", "0%", "up-is-good"],
      ["Replies", "0", "0%", "up-is-good"],
      ["Link clicks", "0", "0%", "up-is-good"],
      ["X spend", "$0.03", "+100%", "neutral"],
    ]);
    expect(tiles.headline.map((tile) => tile.spark)).toStrictEqual([
      "M0 24 L100 0",
      "M0 12 L100 12",
      null,
      "M0 24 L100 0",
    ]);
    expect(tiles.secondary.every((tile) => tile.spark === null)).toBe(true);
    const none = kpis(current, null, []);
    expect([...none.headline, ...none.secondary].every((tile) => tile.delta === null)).toBe(true);
  });

  it("metric values and bucket labels", () => {
    const values = { ...ZERO, impressions: 9, likes: 2, linkClicks: 1 };
    expect([
      metricValue(values, "engagements"),
      metricValue(values, "impressions"),
      metricValue(values, "linkClicks"),
    ]).toStrictEqual([3, 9, 1]);
    expect(bucketLabel(rangeWindow("24h", T0, null), T0)).toBe("Oct 27 12:00");
    expect(bucketLabel(rangeWindow("7d", T0, null), T0)).toBe("Oct 27");
  });
});
