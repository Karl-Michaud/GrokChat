/**
 * I9 / R16: each part's calls stay within the worst case it reserved (A4, U16). Calls are counted
 * by pool on the stubs: D1 tables and R2 are Cloudflare-service calls; X calls are external; the
 * token store is the DO's own storage and counts in neither.
 */
import { describe, expect, it } from "vitest";
import {
  invocationBudget,
  partCostForMediaCount,
  TOKEN_STEP_COST,
} from "../../src/entities/budget/budget";
import { postId, type StagedMediaId } from "../../src/entities/identity/ids";
import type { Post } from "../../src/entities/posts/post";
import { HOUR } from "../../src/entities/time/instant";
import type { XFailure } from "../../src/entities/x/x_failure";
import { MemoryBudgetMeter } from "../../src/frameworks/memory/memory_budget";
import type { BudgetMeter } from "../../src/use_cases/ports/budget_meter";
import type { PartStep } from "../../src/use_cases/run_services/part_sender";
import { ACCOUNT, aPolicy, aPost, part } from "../unit/support/builders";
import { makeWorld, type World } from "../unit/support/world";
import { required } from "../unit/support/publishing";

interface Counts {
  cloudflare: number;
  external: number;
}

/** Inside the commitPart batch, the stub's own writes are one D1 batch, not separate calls. */
let insideBatch = false;

function instrument(world: World): Counts {
  const counts: Counts = { cloudflare: 0, external: 0 };
  const wrap = (
    target: object,
    pool: keyof Counts,
    only: readonly string[] | null = null,
  ): void => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(target)).filter(
      (name) => name !== "constructor" && (only === null || only.includes(name)),
    );
    for (const name of methods) {
      const record = target as Record<string, (...args: unknown[]) => unknown>;
      const original = record[name];
      if (typeof original === "function") {
        record[name] = (...args: unknown[]) => {
          counts[pool] += insideBatch ? 0 : 1;
          return original.apply(target, args);
        };
      }
    }
  };
  for (const port of [
    world.reader,
    world.accounts,
    world.media,
    world.usage,
    world.blobs,
    world.audit,
    world.costs,
  ]) {
    wrap(port, "cloudflare");
  }
  const writer = world.writer as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  for (const name of ["add", "save", "commitPart"] as const) {
    const original = writer[name]?.bind(world.writer);
    writer[name] = async (...args: unknown[]) => {
      counts.cloudflare += insideBatch ? 0 : 1;
      const outer = !insideBatch;
      insideBatch = name === "commitPart" || insideBatch;
      try {
        return await (original === undefined ? Promise.resolve() : original(...args));
      } finally {
        insideBatch = outer ? false : insideBatch;
      }
    };
  }
  for (const port of [world.xPublisher, world.uploader]) {
    wrap(port, "external");
  }
  // `issue` is the fake's own bookkeeping; only `refresh` is a call to X.
  wrap(world.tokenEndpoint, "external", ["refresh"]);
  return counts;
}

/** Runs publishDue and returns the calls each `sendNext` made, by pool. */
async function perPart(
  world: World,
  counts: Counts,
): Promise<readonly (Counts & { readonly media: number })[]> {
  const parts: (Counts & { media: number })[] = [];
  const sendNext = world.sender.sendNext.bind(world.sender);
  world.sender.sendNext = async (post: Post, meter: BudgetMeter): Promise<PartStep> => {
    const before = { ...counts };
    const media = post.parts.find((p) => p.state.kind !== "SENT")?.media.length ?? 0;
    const step = await sendNext(post, meter);
    parts.push({
      cloudflare: counts.cloudflare - before.cloudflare,
      external: counts.external - before.external,
      media,
    });
    return step;
  };
  await world.publishPost.publishDue(
    ACCOUNT,
    new MemoryBudgetMeter(invocationBudget(world.clock.now() + HOUR)),
  );
  return parts;
}

function within(part: Counts & { readonly media: number }): boolean {
  const worst = partCostForMediaCount(part.media);
  return (
    part.cloudflare <= worst.cloudflareCalls + TOKEN_STEP_COST.cloudflareCalls &&
    part.external <= worst.externalSubrequests + TOKEN_STEP_COST.externalSubrequests
  );
}

async function scenario(
  mediaPerPart: readonly number[],
  setup: (world: World) => void = () => undefined,
): Promise<readonly (Counts & { readonly media: number })[]> {
  const world = makeWorld();
  await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
  const parts = [];
  for (const [index, count] of mediaPerPart.entries()) {
    const ids: StagedMediaId[] = [];
    for (let item = 0; item < count; item += 1) {
      ids.push(
        (
          await world.stage(
            ACCOUNT,
            count === 1 ? "GIF" : "PHOTO",
            `m-${String(index)}-${String(item)}`,
          )
        ).id,
      );
    }
    parts.push(part(`part ${String(index)}`, undefined, ids));
  }
  world.table.rows.set(postId("p"), aPost({ id: postId("p"), parts }));
  setup(world);
  const counts = instrument(world);
  return perPart(world, counts);
}

const http = (status: number): XFailure => ({
  kind: "http",
  status,
  detail: "x",
  retryAt: null,
  scope: "user",
});

describe("I9: every part's calls fit the worst case it reserved", () => {
  it("a thread of text parts", async () => {
    const parts = await scenario([0, 0, 0]);
    expect(parts).toHaveLength(3);
    expect(parts.every(within)).toBe(true);
    expect(parts[0]).toStrictEqual({ cloudflare: 4, external: 1, media: 0 });
  });

  it("four photos, and a GIF", async () => {
    const parts = await scenario([4, 1]);
    expect(parts.every(within)).toBe(true);
    expect(parts[0]).toStrictEqual({ cloudflare: 4 + 4 * 6, external: 5, media: 4 });
  });

  it("an expired token refreshed before the part", async () => {
    const parts = await scenario([0], (world) => {
      world.clock.advance(3 * HOUR);
      world.table.rows.set(postId("p"), {
        ...required(world.table.rows.get(postId("p"))),
        publishAt: world.clock.now(),
      });
    });
    expect(parts).toStrictEqual([{ cloudflare: 4, external: 2, media: 0 }]);
    expect(parts.every(within)).toBe(true);
  });

  it("the worst failure paths: a lost token, a 401 from create, a refused upload", async () => {
    const lost = await scenario([0], (world) => {
      world.tokenStore.rows.clear();
    });
    const revoked = await scenario([0], (world) =>
      world.x.scripts.create.push({ kind: "fail", failure: http(401) }),
    );
    const upload = await scenario([2], (world) =>
      world.x.scripts.upload.push({ kind: "ok" }, { kind: "fail", failure: http(401) }),
    );
    for (const parts of [lost, revoked, upload]) {
      expect(parts.every(within)).toBe(true);
    }
    expect(lost).toStrictEqual([{ cloudflare: 3, external: 0, media: 0 }]);
    expect(revoked).toStrictEqual([{ cloudflare: 5, external: 1, media: 0 }]);
  });
});
