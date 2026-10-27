/** D1 behaviour the shared contracts cannot see: the raising guard, indexes, windows, errors. */
import { env } from "cloudflare:workers";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { botId, idempotencyKey, postId, xPostId } from "../../src/entities/identity/ids";
import { metricsDue, METRICS_SCHEDULE } from "../../src/entities/metrics/metrics_due";
import { DAY, HOUR, MINUTE } from "../../src/entities/time/instant";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { nextMetricsAtSql } from "../../src/frameworks/d1/metrics_next";
import { RECENT_WINDOW } from "../../src/frameworks/d1/d1_post_reader";
import { guardedBatch, isGuardFailure } from "../../src/frameworks/d1/version_guard";
import { freshStorage } from "../integration/support/fresh_d1";
import { metered } from "../integration/support/metered_d1";
import {
  ACCOUNT,
  aMedia,
  anAccount,
  aPolicy,
  aPost,
  part,
  sendingState,
  sentState,
  T0,
  unknownState,
} from "../unit/support/builders";

beforeEach(freshStorage);

const AUDIT = {
  at: T0,
  actor: "system:x",
  action: "x.create",
  accountId: ACCOUNT,
  postId: postId("post-1"),
  detail: "sent",
};
const COST = {
  at: T0,
  accountId: ACCOUNT,
  operation: "create",
  estimate: { kind: "usd", micros: 15_000 },
} as const;

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? -1;
}

describe("R21: the raising version_guard batch", () => {
  it("a stale version or lifecycle changes nothing, the part index and records included", async () => {
    const { reader, writer } = d1Stores(env.DB);
    const post = aPost({ lifecycle: "PUBLISHING", parts: [part("a", sendingState())], version: 5 });
    await writer.add(post);
    const done = {
      ...post,
      lifecycle: "DONE",
      parts: [part("a", sentState("x"))],
      version: 6,
    } as const;
    for (const [version, lifecycle] of [
      [4, "PUBLISHING"],
      [5, "RESUMING"],
    ] as const) {
      expect(await writer.commitPart(done, version, lifecycle, AUDIT, COST)).toStrictEqual({
        kind: "version_conflict",
      });
    }
    expect(await reader.get(post.id)).toStrictEqual(post);
    expect(await reader.list({ partStates: ["SENT"] })).toStrictEqual([]);
    expect([await count("audit_events"), await count("cost_entries")]).toStrictEqual([0, 0]);
    expect(await count("version_guard")).toBe(0);
    expect(await writer.commitPart(done, 5, "PUBLISHING", AUDIT, COST)).toStrictEqual({
      kind: "ok",
    });
    expect(await reader.list({ partStates: ["SENT"] })).toStrictEqual([done]);
    expect(await count("version_guard")).toBe(0);
  });

  it("a stale write after recovery is a VersionConflict, never a SENT over UNKNOWN (R1)", async () => {
    const { reader, writer } = d1Stores(env.DB);
    const sending = aPost({
      lifecycle: "PUBLISHING",
      parts: [part("a", sendingState())],
      version: 2,
    });
    await writer.add(sending);
    const recovered = {
      ...sending,
      lifecycle: "DONE",
      parts: [part("a", unknownState())],
      version: 3,
    } as const;
    expect(await writer.save(recovered, 2, "PUBLISHING")).toStrictEqual({ kind: "ok" });
    const late = {
      ...sending,
      lifecycle: "DONE",
      parts: [part("a", sentState("x"))],
      version: 3,
    } as const;
    expect(await writer.commitPart(late, 2, "PUBLISHING", AUDIT, COST)).toStrictEqual({
      kind: "version_conflict",
    });
    expect(await reader.get(sending.id)).toStrictEqual(recovered);
  });

  it("any other failure is rethrown, and only the guard's own error counts as a conflict", async () => {
    const post = aPost();
    await d1Stores(env.DB).writer.add(post);
    const broken = env.DB.prepare("INSERT INTO posts (id) VALUES (NULL)");
    await expect(
      guardedBatch(env.DB, { id: post.id, version: 1, lifecycle: "SCHEDULED" }, [broken]),
    ).rejects.toThrow(/NOT NULL constraint failed: posts/);
    expect(isGuardFailure(new Error("NOT NULL constraint failed: posts.id"))).toBe(false);
    expect(isGuardFailure("NOT NULL constraint failed: version_guard.ok")).toBe(false);
    expect(await count("version_guard")).toBe(0);
  });
});

describe("add", () => {
  it("a duplicate (bot, key) returns the stored post; any other failure is rethrown (R14)", async () => {
    const { writer } = d1Stores(env.DB);
    const provenance = { ...aPost().provenance, botId: botId("b") };
    const first = aPost({ id: postId("a"), idempotencyKey: idempotencyKey("k"), provenance });
    const results = await Promise.all([
      writer.add(first),
      writer.add({ ...first, id: postId("b"), requestHash: "other" }),
    ]);
    expect(results.map((result) => result.kind).sort()).toStrictEqual(["added", "duplicate"]);
    expect(await count("posts")).toBe(1);
    await expect(writer.add({ ...first, idempotencyKey: idempotencyKey("new") })).rejects.toThrow(
      /UNIQUE constraint failed: posts.id/,
    );
    await expect(writer.add(aPost({ id: postId("a") }))).rejects.toThrow(/UNIQUE/);
  });
});

describe("the per-minute queries read an index, not the table (plan §3.5, I9)", () => {
  it("accountsNeedingWork, the due list and recentActivity read a few rows among 300 old posts", async () => {
    const { writer } = d1Stores(env.DB);
    for (let index = 0; index < 300; index += 1) {
      const id = postId(`old-${String(index).padStart(3, "0")}`);
      await writer.add(aPost({ id, lifecycle: "CANCELLED", publishAt: T0 - 60 * DAY }));
    }
    await writer.add(aPost({ id: postId("due"), publishAt: T0 - MINUTE }));
    const meter = metered(env.DB);
    const reader = d1Stores(meter.db).reader;
    const reads: number[] = [];
    const measure = async <T>(run: () => Promise<T>): Promise<T> => {
      const before = meter.rowsRead;
      const value = await run();
      reads.push(meter.rowsRead - before);
      return value;
    };
    const work = await measure(() => reader.accountsNeedingWork(T0));
    expect(work.map((item) => item.accountId)).toStrictEqual([ACCOUNT]);
    const due = await measure(() => reader.list({ accountIds: [ACCOUNT], dueBy: T0 }));
    expect(due.map((post) => post.id)).toStrictEqual(["due"]);
    expect(await measure(() => reader.recentActivity(ACCOUNT, T0))).toStrictEqual({ posts: [] });
    expect(meter.calls).toBe(3);
    for (const rows of reads) {
      expect(rows).toBeLessThan(20);
    }
  });

  it("recentActivity keeps the window and the latest attempt, and drops older posts", async () => {
    const { reader, writer } = d1Stores(env.DB);
    const at = (id: string, time: number) =>
      aPost({ id: postId(id), lifecycle: "DONE", parts: [part(id, sentState(id, time))] });
    await writer.add(at("ancient", T0 - 10 * DAY));
    await writer.add(at("inside", T0 - RECENT_WINDOW));
    await writer.add(at("recent", T0 - HOUR));
    expect((await reader.recentActivity(ACCOUNT, T0)).posts.map((p) => p.postId)).toStrictEqual([
      "inside",
      "recent",
    ]);
    expect(
      (await reader.recentActivity(ACCOUNT, T0 + 20 * DAY)).posts.map((p) => p.postId),
    ).toStrictEqual(["recent"]);
  });
});

describe("metrics: the indexed next-read instant", () => {
  it("is due exactly when metricsDue says so (fast-check, boundaries included)", async () => {
    const sql = `SELECT ${nextMetricsAtSql("?1", "?2")} AS next`;
    const near = (sent: number) =>
      fc.oneof(
        fc.integer({ min: sent - DAY, max: sent + 31 * DAY }),
        fc
          .tuple(fc.constantFrom(...METRICS_SCHEDULE), fc.integer({ min: -1, max: 1 }))
          .map(([offset, delta]) => sent + offset + delta),
      );
    const cases = fc
      .integer({ min: T0 - 40 * DAY, max: T0 })
      .chain((sent) =>
        fc.tuple(fc.constant(sent), fc.option(near(sent), { nil: null }), near(sent)),
      );
    await fc.assert(
      fc.asyncProperty(cases, async ([sent, taken, now]) => {
        const row = await env.DB.prepare(sql).bind(sent, taken).first<{ next: number | null }>();
        const next = row?.next ?? null;
        expect(next !== null && next <= now).toBe(metricsDue(sent, taken, now));
      }),
      { numRuns: 300 },
    );
  });

  it("a part that is not SENT has no next read", async () => {
    const row = await env.DB.prepare(`SELECT ${nextMetricsAtSql("?1", "?2")} AS next`)
      .bind(null, null)
      .first<{ next: number | null }>();
    expect(row?.next).toBeNull();
  });

  it("a read moves the part's next read on; an empty batch writes nothing", async () => {
    const { reader, writer, metrics } = d1Stores(env.DB);
    const sent = T0 - 2 * HOUR;
    await writer.add(aPost({ lifecycle: "DONE", parts: [part("a", sentState("x-1", sent))] }));
    expect((await reader.accountsNeedingWork(T0))[0]?.metrics).toBe(true);
    await metrics.addSnapshots([]);
    await metrics.addSnapshots([
      {
        xPostId: xPostId("x-1"),
        accountId: ACCOUNT,
        takenAt: T0 - MINUTE,
        impressions: 1,
        likes: 1,
        reposts: 1,
        replies: 1,
        quotes: 1,
        bookmarks: 1,
        urlLinkClicks: 1,
        userProfileClicks: 1,
      },
    ]);
    expect(await reader.accountsNeedingWork(T0)).toStrictEqual([]);
    expect((await reader.accountsNeedingWork(sent + 6 * HOUR))[0]?.metrics).toBe(true);
  });
});

describe("rows round-trip every field", () => {
  it("accounts, media and audit events with their nullable and boolean columns", async () => {
    const { accounts, media, audit, costs } = d1Stores(env.DB);
    const account = anAccount({
      disclosure: { bioConfirmed: false, automatedLabelConfirmed: false },
      isAppOwner: true,
      policy: aPolicy({ quietHours: { startMinute: 60, endMinute: 120 }, tz: "Europe/Paris" }),
    });
    await accounts.save(account);
    expect(await accounts.get(account.id)).toStrictEqual(account);
    const attached = aMedia({ attachedTo: postId("post-9"), kind: "GIF" });
    await media.save(attached);
    expect(await media.get(attached.id)).toStrictEqual(attached);
    const event = { ...AUDIT, accountId: null, postId: null };
    await audit.append(event);
    expect(await audit.list({ limit: 0 })).toStrictEqual([]);
    expect(await audit.list({})).toStrictEqual([event]);
    expect(await costs.totals({ from: T0, to: T0 + 1 }, null)).toStrictEqual({
      micros: 0,
      calls: 0,
      unknownPriced: 0,
    });
  });
});
