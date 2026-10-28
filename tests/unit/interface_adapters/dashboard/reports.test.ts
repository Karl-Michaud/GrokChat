import { describe, expect, it } from "vitest";
import { accountId, postId, xPostId } from "../../../../src/entities/identity/ids";
import type { MetricsSnapshot } from "../../../../src/entities/metrics/metrics_snapshot";
import { DAY, HOUR } from "../../../../src/entities/time/instant";
import { ReportsController } from "../../../../src/interface_adapters/dashboard/reports_controller";
import { costRow, usd } from "../../../../src/interface_adapters/dashboard/report_views";
import { SessionController } from "../../../../src/interface_adapters/dashboard/session_controller";
import { ACCOUNT, anAccount, T0 } from "../../support/builders";
import { dashboardUseCases, presenting } from "../../support/dashboard";
import { makeWorld } from "../../support/world";

async function setup() {
  const world = makeWorld();
  await world.seedAccount();
  await world.accounts.save(anAccount({ id: accountId("acc-2"), handle: "two" }));
  const useCases = dashboardUseCases(world);
  return { world, useCases, reports: new ReportsController(useCases, world.clock) };
}

const snapshot = (id: string, takenAt: number, impressions: number): MetricsSnapshot => ({
  xPostId: xPostId(id),
  accountId: ACCOUNT,
  takenAt,
  impressions,
  likes: 1,
  reposts: 2,
  replies: 3,
  quotes: 4,
  bookmarks: 5,
  urlLinkClicks: null,
  userProfileClicks: null,
});

const refusedDays = (max: number) => ({
  kind: "refused",
  status: 400,
  message: `Days must be a whole number from 1 to ${String(max)}.`,
});

describe("the metrics page", () => {
  it("shows the first account's totals over the last seven days by default", async () => {
    const { reports, world } = await setup();
    await world.metrics.addSnapshots([
      snapshot("x-1", T0 - 8 * DAY, 1000),
      snapshot("x-1", T0 - HOUR, 10),
      snapshot("x-2", T0 - 2 * HOUR, 20),
    ]);
    expect(await reports.metrics({ account: null, days: null })).toStrictEqual({
      kind: "page",
      view: {
        accounts: [
          { id: "acc-1", handle: "@musechat_one", selected: true },
          { id: "acc-2", handle: "@two", selected: false },
        ],
        account: "@musechat_one",
        days: 7,
        posts: 2,
        totals: [
          { name: "impressions", value: 30 },
          { name: "likes", value: 2 },
          { name: "reposts", value: 4 },
          { name: "replies", value: 6 },
          { name: "quotes", value: 8 },
          { name: "bookmarks", value: 10 },
        ],
        snapshots: 2,
      },
    });
    const longer = await reports.metrics({ account: "acc-1", days: "9" });
    expect(longer).toMatchObject({ view: { days: 9, snapshots: 3 } });
    const other = await reports.metrics({ account: "acc-2", days: "90" });
    expect(other).toMatchObject({ view: { account: "@two", posts: 0, days: 90 } });
  });

  it("shows an empty page with no accounts, and refuses bad days or a refusal", async () => {
    const world = makeWorld();
    const useCases = dashboardUseCases(world);
    const reports = new ReportsController(useCases, world.clock);
    expect(await reports.metrics({ account: null, days: "1" })).toStrictEqual({
      kind: "page",
      view: { accounts: [], account: null, days: 1, posts: 0, totals: [], snapshots: 0 },
    });
    for (const days of ["0", "91", "x"]) {
      expect(await reports.metrics({ account: null, days })).toStrictEqual(refusedDays(90));
    }
    const refusing = new ReportsController(
      { ...useCases, accountMetrics: presenting({ ok: false, code: "scope" }) },
      world.clock,
    );
    expect(await refusing.metrics({ account: "acc-1", days: null })).toMatchObject({
      status: 403,
    });
  });
});

describe("the costs page", () => {
  it("totals the window for every account and for each one", async () => {
    const { reports, world } = await setup();
    const entry = (at: number, micros: number | null, account = ACCOUNT) =>
      world.costs.append({
        at,
        accountId: account,
        operation: "create",
        estimate: micros === null ? { kind: "unknown" } : { kind: "usd", micros },
      });
    await entry(T0 - HOUR, 15_000);
    await entry(T0 - 2 * HOUR, null);
    await entry(T0 - HOUR, 200_000, accountId("acc-2"));
    await entry(T0 - 31 * DAY, 999_000);
    expect(await reports.costs({ days: null })).toStrictEqual({
      kind: "page",
      view: {
        days: 30,
        total: { label: "All accounts", usd: "$0.2150", calls: 3, unknownPriced: 1 },
        accounts: [
          { label: "@musechat_one", usd: "$0.0150", calls: 2, unknownPriced: 1 },
          { label: "@two", usd: "$0.2000", calls: 1, unknownPriced: 0 },
        ],
      },
    });
    expect(await reports.costs({ days: "366" })).toMatchObject({
      view: { total: { usd: "$1.2140", calls: 4 } },
    });
    expect(await reports.costs({ days: "367" })).toStrictEqual(refusedDays(366));
    expect(await reports.costs({ days: "0" })).toStrictEqual(refusedDays(366));
  });

  it("refuses when the totals are refused, and skips an account whose totals are", async () => {
    const { useCases, world } = await setup();
    const refusing = new ReportsController(
      { ...useCases, costTotals: presenting({ ok: false, code: "human_only" }) },
      world.clock,
    );
    expect(await refusing.costs({ days: null })).toMatchObject({ kind: "refused", status: 403 });
    let calls = 0;
    const partly = new ReportsController(
      {
        ...useCases,
        costTotals: (presenter) => {
          calls += 1;
          return calls === 2
            ? presenting({ ok: false as const, code: "human_only" as const })(presenter)
            : useCases.costTotals(presenter);
        },
      },
      world.clock,
    );
    expect(await partly.costs({ days: null })).toMatchObject({
      view: { accounts: [{ label: "@two" }] },
    });
  });

  it("formats micro-dollars with four decimals", () => {
    expect(usd(0)).toBe("$0.0000");
    expect(usd(15_000)).toBe("$0.0150");
    expect(usd(1_234_567)).toBe("$1.2346");
    expect(costRow("x", { micros: 1, calls: 2, unknownPriced: 3 })).toStrictEqual({
      label: "x",
      usd: "$0.0000",
      calls: 2,
      unknownPriced: 3,
    });
  });
});

describe("the media page", () => {
  it("shows R2 use against the guard and the free allowance (plan §3.5)", async () => {
    const { reports, world } = await setup();
    await world.usage.record({ storedBytes: 8_000_000_000, classA: 1_234, classB: 0 }, T0);
    expect(await reports.media()).toStrictEqual({
      kind: "page",
      view: {
        month: "2026-10",
        rows: [
          {
            name: "Stored bytes",
            used: "8,000,000,000",
            guard: "8,000,000,000",
            allowance: "10,000,000,000",
            percent: "80.0%",
            atGuard: true,
          },
          {
            name: "Class A operations",
            used: "1,234",
            guard: "800,000",
            allowance: "1,000,000",
            percent: "0.1%",
            atGuard: false,
          },
          {
            name: "Class B operations",
            used: "0",
            guard: "8,000,000",
            allowance: "10,000,000",
            percent: "0.0%",
            atGuard: false,
          },
        ],
      },
    });
    await world.usage.record({ storedBytes: -1, classA: 0, classB: 0 }, T0);
    const below = await reports.media();
    expect(below.kind === "page" && below.view.rows[0]?.atGuard).toBe(false);
  });

  it("shows a refusal", async () => {
    const { useCases, world } = await setup();
    const refusing = new ReportsController(
      { ...useCases, mediaUsage: presenting({ ok: false, code: "human_only" }) },
      world.clock,
    );
    expect(await refusing.media()).toMatchObject({ kind: "refused", status: 403 });
  });
});

describe("the audit page", () => {
  it("lists the newest events, by account, up to a limit", async () => {
    const { reports, world } = await setup();
    const event = (action: string, account: string | null, post: string | null) =>
      world.audit.append({
        at: T0,
        actor: "human:admin",
        action,
        accountId: account === null ? null : accountId(account),
        postId: post === null ? null : postId(post),
        detail: `d-${action}`,
      });
    await event("one", "acc-1", "post-1");
    await event("two", null, null);
    await event("three", "acc-9", null);
    const all = await reports.audit({ account: null, limit: null });
    expect(all).toStrictEqual({
      kind: "page",
      view: {
        accounts: [
          { id: "acc-1", handle: "@musechat_one", selected: false },
          { id: "acc-2", handle: "@two", selected: false },
        ],
        limit: 100,
        events: [
          {
            at: "2026-10-27 12:00 UTC",
            actor: "human:admin",
            action: "three",
            account: "acc-9",
            postId: null,
            postHref: null,
            detail: "d-three",
          },
          {
            at: "2026-10-27 12:00 UTC",
            actor: "human:admin",
            action: "two",
            account: "",
            postId: null,
            postHref: null,
            detail: "d-two",
          },
          {
            at: "2026-10-27 12:00 UTC",
            actor: "human:admin",
            action: "one",
            account: "@musechat_one",
            postId: "post-1",
            postHref: "/dashboard/posts/post-1",
            detail: "d-one",
          },
        ],
      },
    });
    const mine = await reports.audit({ account: "acc-1", limit: "500" });
    expect(mine).toMatchObject({
      view: { limit: 500, events: [{ action: "one" }], accounts: [{ selected: true }, {}] },
    });
    expect(await reports.audit({ account: null, limit: "1" })).toMatchObject({
      view: { events: [{ action: "three" }] },
    });
    expect(await reports.audit({ account: null, limit: "501" })).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "The limit must be a whole number from 1 to 500.",
    });
  });

  it("shows a refusal", async () => {
    const { useCases, world } = await setup();
    const refusing = new ReportsController(
      { ...useCases, auditList: presenting({ ok: false, code: "human_only" }) },
      world.clock,
    );
    expect(await refusing.audit({ account: null, limit: null })).toMatchObject({ status: 403 });
  });
});

describe("the login form (R12)", () => {
  it("redirects home on the right password, 401 on a wrong one, 429 when throttled", async () => {
    const world = makeWorld();
    const controller = new SessionController(dashboardUseCases(world));
    const login = (password: string) => controller.login({ password, clientKey: "9.9.9.9" });
    expect(await login("pw")).toStrictEqual({ kind: "redirect", location: "/dashboard/backlog" });
    expect(world.audit.events.at(-1)?.actor).toBe("human:admin");
    expect(await login("bad")).toStrictEqual({
      kind: "refused",
      status: 401,
      message: "Wrong password.",
    });
    for (let i = 0; i < 4; i += 1) {
      await login("bad");
    }
    expect(world.throttle.failures.get("ip:9.9.9.9")).toHaveLength(5);
    expect(await login("pw")).toStrictEqual({
      kind: "refused",
      status: 429,
      message: "Too many failed logins; wait fifteen minutes.",
    });
  });
});
