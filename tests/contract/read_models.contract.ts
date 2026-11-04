/** The dashboard's read ports (GROKCHAT-15), for the stubs and the D1 drivers alike. */
import { expect, it } from "vitest";
import { postId, xPostId } from "../../src/entities/identity/ids";
import { HOUR, MINUTE } from "../../src/entities/time/instant";
import type { ActivityLog } from "../../src/use_cases/ports/activity_log";
import type { AuditLog } from "../../src/use_cases/ports/audit_log";
import type { CostLedger } from "../../src/use_cases/ports/cost_ledger";
import type { FollowerDays } from "../../src/use_cases/ports/follower_days";
import type { FollowerHistory } from "../../src/use_cases/ports/follower_history";
import type { MetricsHistory } from "../../src/use_cases/ports/metrics_history";
import type { MetricsRepository } from "../../src/use_cases/ports/metrics_repository";
import { ACCOUNT, aFollowerSnapshot, aSnapshot, OTHER_ACCOUNT, T0 } from "../unit/support/builders";

const WINDOW = { from: T0, to: T0 + HOUR };
const at = (snapshots: readonly { readonly takenAt: number }[]) => snapshots.map((s) => s.takenAt);

export function metricsHistoryContract(make: () => MetricsRepository & MetricsHistory): void {
  it("a window's reads, and each post's newest read before it, oldest first", async () => {
    const repo = make();
    await repo.addSnapshots([
      aSnapshot("a", T0 - 2 * HOUR, 1),
      aSnapshot("a", T0 - HOUR, 2),
      aSnapshot("b", T0 - HOUR, 3),
      aSnapshot("a", T0 + MINUTE, 4),
      aSnapshot("c", T0 + 2 * MINUTE, 5, { accountId: OTHER_ACCOUNT }),
      aSnapshot("a", T0 + HOUR, 6),
    ]);
    const all = await repo.history(null, WINDOW);
    expect(all.map((s) => [s.xPostId, s.impressions])).toStrictEqual([
      [xPostId("a"), 2],
      [xPostId("a"), 4],
      [xPostId("c"), 5],
    ]);
    expect(at(await repo.history(ACCOUNT, WINDOW))).toStrictEqual([T0 - HOUR, T0 + MINUTE]);
    expect(await repo.history(OTHER_ACCOUNT, { from: T0 + HOUR, to: T0 + 2 * HOUR })).toStrictEqual(
      [],
    );
  });

  it("a post's whole series, oldest first; none for unknown ids", async () => {
    const repo = make();
    await repo.addSnapshots([aSnapshot("a", T0 + 2, 2), aSnapshot("b", T0 + 1, 1)]);
    await repo.addSnapshots([aSnapshot("a", T0, 1)]);
    const series = await repo.postSeries([xPostId("a"), xPostId("b")]);
    expect(series.map((s) => [s.xPostId, s.takenAt])).toStrictEqual([
      [xPostId("a"), T0],
      [xPostId("b"), T0 + 1],
      [xPostId("a"), T0 + 2],
    ]);
    expect(await repo.postSeries([xPostId("zz")])).toStrictEqual([]);
    expect(await repo.postSeries([])).toStrictEqual([]);
  });
}

export function followerHistoryContract(make: () => FollowerDays & FollowerHistory): void {
  const record = async (store: FollowerDays, time: number, count: number, account = ACCOUNT) => {
    const snapshot = aFollowerSnapshot(time, count, account);
    await store.claim(account, snapshot.day, time);
    await store.record(snapshot);
  };

  it("recorded reads in the window, and each account's newest before it; no bare claims", async () => {
    const store = make();
    await record(store, T0 - 48 * HOUR, 10);
    await record(store, T0 - 24 * HOUR, 12);
    await record(store, T0 + MINUTE, 15);
    await record(store, T0 + 2 * MINUTE, 99, OTHER_ACCOUNT);
    await store.claim(ACCOUNT, "2026-10-29", T0);
    const all = await store.history(null, WINDOW);
    expect(all.map((s) => [s.accountId, s.followers])).toStrictEqual([
      [ACCOUNT, 12],
      [ACCOUNT, 15],
      [OTHER_ACCOUNT, 99],
    ]);
    expect((await store.history(ACCOUNT, WINDOW)).map((s) => s.followers)).toStrictEqual([12, 15]);
    expect(await store.history(OTHER_ACCOUNT, { from: 0, to: T0 })).toStrictEqual([]);
  });
}

export interface ActivityHarness {
  readonly activity: ActivityLog;
  readonly audit: AuditLog;
  readonly costs: CostLedger;
}

const event = (time: number, actor: string, action: string, post: string | null = null) => ({
  at: time,
  actor,
  action,
  accountId: ACCOUNT,
  postId: post === null ? null : postId(post),
  detail: action,
});

export function activityLogContract(make: () => ActivityHarness): void {
  async function seeded(): Promise<ActivityLog> {
    const { activity, audit, costs } = make();
    await audit.append(event(T0, "bot:b1", "post.create", "p1"));
    await audit.append(event(T0 + 1, "system:x", "x.create", "p1"));
    await costs.append({
      at: T0 + 1,
      accountId: ACCOUNT,
      operation: "create",
      estimate: { kind: "usd", micros: 15_000 },
    });
    await audit.append(event(T0 + 2, "system:x", "x.media_upload"));
    await costs.append({
      at: T0 + 2,
      accountId: ACCOUNT,
      operation: "media_upload",
      estimate: { kind: "unknown" },
    });
    await audit.append(event(T0 + 3, "human:admin", "refused.post.edit", "p1"));
    await audit.append({ ...event(T0 + 4, "system:x", "x.user_read"), accountId: OTHER_ACCOUNT });
    return activity;
  }

  it("lists newest first, with the X call's cost joined, a page at a time", async () => {
    const activity = await seeded();
    const all = await activity.page({}, 0, 10);
    expect(all.total).toBe(5);
    expect(all.entries.map((e) => [e.action, e.cost])).toStrictEqual([
      ["x.user_read", null],
      ["refused.post.edit", null],
      ["x.media_upload", { kind: "unknown" }],
      ["x.create", { kind: "usd", micros: 15_000 }],
      ["post.create", null],
    ]);
    const second = await activity.page({}, 2, 2);
    expect([second.total, second.entries.map((e) => e.at)]).toStrictEqual([5, [T0 + 2, T0 + 1]]);
  });

  it("filters by account, post, actor, kind and window", async () => {
    const activity = await seeded();
    const actions = async (filter: Parameters<ActivityLog["page"]>[0]) =>
      (await activity.page(filter, 0, 10)).entries.map((e) => e.action);
    expect(await actions({ accountId: OTHER_ACCOUNT })).toStrictEqual(["x.user_read"]);
    expect(await actions({ postId: postId("p1") })).toStrictEqual([
      "refused.post.edit",
      "x.create",
      "post.create",
    ]);
    expect(await actions({ actor: "bot" })).toStrictEqual(["post.create"]);
    expect(await actions({ actor: "human" })).toStrictEqual(["refused.post.edit"]);
    expect(await actions({ kind: "posts" })).toStrictEqual(["post.create"]);
    expect(await actions({ kind: "refusals" })).toStrictEqual(["refused.post.edit"]);
    expect(await actions({ kind: "publishing" })).toStrictEqual(["x.media_upload", "x.create"]);
    expect(await actions({ kind: "reads" })).toStrictEqual(["x.user_read"]);
    expect(await actions({ window: { from: T0 + 1, to: T0 + 3 } })).toStrictEqual([
      "x.media_upload",
      "x.create",
    ]);
    const both = await activity.page({ actor: "system", kind: "publishing" }, 0, 1);
    expect([both.total, both.entries.map((e) => e.action)]).toStrictEqual([2, ["x.media_upload"]]);
  });
}
