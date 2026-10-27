/**
 * The D1 post reader answers exactly as the in-memory stub over random tables (fast-check): the
 * indexed SQL forms of `dueAt`, `metricsDue` and the gate's activity window are checked against
 * the entity functions the stub calls.
 */
import { env } from "cloudflare:workers";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { accountId, postId, xPostId } from "../../src/entities/identity/ids";
import type { MetricsSnapshot } from "../../src/entities/metrics/metrics_snapshot";
import { checkPublishable, nextAllowedAt } from "../../src/entities/policy/publishable";
import { LIFECYCLES, type Post } from "../../src/entities/posts/post";
import { PART_STATE_KINDS, type PartState } from "../../src/entities/posts/part_state";
import { DAY, HOUR } from "../../src/entities/time/instant";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import type { PostFilter, PostReader } from "../../src/use_cases/ports/post_reader";
import {
  MemoryPostReader,
  MemoryPostTable,
  MemoryPostWriter,
} from "../../src/frameworks/memory/memory_post_store";
import {
  MemoryAuditLog,
  MemoryCostLedger,
  MemoryMetricsRepository,
} from "../../src/frameworks/memory/memory_records";
import { aPolicy, aPost, anAccount, part, T0 } from "../unit/support/builders";
import { ZONES } from "../unit/support/arbitraries";
import { freshStorage } from "../integration/support/fresh_d1";

const FIRST = accountId("acc-1");
const SECOND = accountId("acc-2");
const ACCOUNTS = [FIRST, SECOND, accountId("acc-3")];
const around = (span: number) => fc.integer({ min: T0 - span, max: T0 + span });

const partState: fc.Arbitrary<PartState> = fc.oneof(
  fc.constant({ kind: "PENDING" } as const),
  around(3 * DAY).map((attemptAt) => ({ kind: "SENDING", attemptAt }) as const),
  fc
    .tuple(fc.integer({ min: 1, max: 40 }), around(40 * DAY))
    .map(([id, at]) => ({ kind: "SENT", xPostId: xPostId(`x-${String(id)}`), at }) as const),
  around(3 * DAY).map((attemptAt) => ({ kind: "UNKNOWN", attemptAt, checks: 0 }) as const),
  fc.constant({ kind: "REJECTED", reason: "no" } as const),
);

const post = (index: number): fc.Arbitrary<Post> =>
  fc
    .record({
      account: fc.constantFrom(...ACCOUNTS),
      lifecycle: fc.constantFrom(...LIFECYCLES),
      publishAt: around(2 * DAY),
      resumeAt: fc.option(around(2 * DAY), { nil: null }),
      states: fc.array(partState, { minLength: 1, maxLength: 3 }),
    })
    .map((drawn) =>
      aPost({
        id: postId(`p-${String(index).padStart(2, "0")}`),
        accountId: drawn.account,
        lifecycle: drawn.lifecycle,
        publishAt: drawn.publishAt,
        resumeAt: drawn.resumeAt,
        parts: drawn.states.map((state, k) => part(`t${String(k)}`, state)),
      }),
    );

const table = fc
  .integer({ min: 0, max: 12 })
  .chain((count) => fc.tuple(...Array.from({ length: count }, (_, index) => post(index))));

const snapshots = fc.array(
  fc.record({ id: fc.integer({ min: 1, max: 40 }), takenAt: around(40 * DAY) }),
  { maxLength: 10 },
);

function snapshot(id: number, takenAt: number): MetricsSnapshot {
  return {
    xPostId: xPostId(`x-${String(id)}`),
    accountId: FIRST,
    takenAt,
    impressions: 1,
    likes: 1,
    reposts: 1,
    replies: 1,
    quotes: 1,
    bookmarks: 1,
    urlLinkClicks: null,
    userProfileClicks: null,
  };
}

async function both(posts: readonly Post[], reads: readonly { id: number; takenAt: number }[]) {
  await freshStorage();
  const d1 = d1Stores(env.DB);
  const metrics = new MemoryMetricsRepository();
  const memoryTable = new MemoryPostTable();
  const memory: PostReader = new MemoryPostReader(memoryTable, metrics);
  const writer = new MemoryPostWriter(memoryTable, new MemoryAuditLog(), new MemoryCostLedger());
  // A part written SENT before its post's reads, as in production (and the reverse for half).
  const half = Math.floor(posts.length / 2);
  for (const item of posts.slice(0, half)) {
    await d1.writer.add(item);
    await writer.add(item);
  }
  const shots = reads.map((read) => snapshot(read.id, read.takenAt));
  await d1.metrics.addSnapshots(shots);
  await metrics.addSnapshots(shots);
  for (const item of posts.slice(half)) {
    await d1.writer.add(item);
    await writer.add(item);
  }
  return { d1: d1.reader, memory };
}

describe("D1 PostReader ≡ the stub (fast-check)", () => {
  it("accountsNeedingWork and list agree on random tables", async () => {
    await fc.assert(
      fc.asyncProperty(table, snapshots, around(DAY), async (posts, reads, now) => {
        const { d1, memory } = await both(posts, reads);
        expect(await d1.accountsNeedingWork(now)).toStrictEqual(
          await memory.accountsNeedingWork(now),
        );
        const filters: readonly PostFilter[] = [
          {},
          { dueBy: now },
          { accountIds: [SECOND] },
          { lifecycles: ["SCHEDULED", "PUBLISHING"] },
          { partStates: PART_STATE_KINDS.slice(1, 4) },
          { publishWindow: { from: now - DAY, to: now } },
        ];
        for (const filter of filters) {
          expect(await d1.list(filter)).toStrictEqual(await memory.list(filter));
        }
      }),
      { numRuns: 60 },
    );
  });

  it("the gate decides the same over the windowed recent activity", async () => {
    const policy = fc.record({
      dailyCap: fc.integer({ min: 1, max: 4 }),
      minGap: fc.integer({ min: 0, max: 3 * HOUR }),
      tz: fc.constantFrom(...ZONES),
    });
    await fc.assert(
      fc.asyncProperty(table, policy, around(DAY), async (posts, drawn, now) => {
        const { d1, memory } = await both(posts, []);
        const account = anAccount({ id: FIRST, policy: aPolicy(drawn) });
        const candidate = aPost({ id: postId("candidate"), accountId: account.id });
        const fromD1 = await d1.recentActivity(account.id, now);
        const fromMemory = await memory.recentActivity(account.id, now);
        expect(checkPublishable(account, candidate, now, fromD1)).toStrictEqual(
          checkPublishable(account, candidate, now, fromMemory),
        );
        expect(nextAllowedAt(account, candidate, now, fromD1)).toBe(
          nextAllowedAt(account, candidate, now, fromMemory),
        );
      }),
      { numRuns: 60 },
    );
  });
});
