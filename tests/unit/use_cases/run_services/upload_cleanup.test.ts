/** The expired uploads' cleanup and the cleanup steps (GROKCHAT-20), inside the tick's budget. */
import { describe, expect, it } from "vitest";
import {
  invocationBudget,
  UPLOAD_CLEANUP_ITEM_COST,
  UPLOAD_CLEANUP_QUERY_COST,
} from "../../../../src/entities/budget/budget";
import { HOUR } from "../../../../src/entities/time/instant";
import { InvocationBudgetMeter } from "../../../../src/frameworks/budget/invocation_meter";
import { ManualClock } from "../../../../src/frameworks/memory/manual_clock";
import { MemoryMediaUsage } from "../../../../src/frameworks/memory/memory_media";
import { MemoryPendingUploads } from "../../../../src/frameworks/memory/memory_pending_uploads";
import type { BudgetMeter } from "../../../../src/use_cases/ports/budget_meter";
import { CleanupSteps } from "../../../../src/use_cases/run_services/cleanup_step";
import {
  UPLOAD_CLEANUP_BATCH,
  UploadCleanup,
} from "../../../../src/use_cases/run_services/upload_cleanup";
import { ACCOUNT, T0 } from "../../support/builders";

const QUERY = UPLOAD_CLEANUP_QUERY_COST.cloudflareCalls;
const ITEM = UPLOAD_CLEANUP_ITEM_COST.cloudflareCalls;

async function setup(count: number, expiresAt = T0) {
  const clock = new ManualClock(T0);
  const uploads = new MemoryPendingUploads();
  const usage = new MemoryMediaUsage();
  for (let index = 0; index < count; index += 1) {
    const upload = {
      id: `u-${String(index).padStart(2, "0")}`,
      accountId: ACCOUNT,
      fileSha256: "f",
      partCount: 2,
      label: null,
      expiresAt,
      mediaId: null,
    };
    await uploads.open(upload);
    await uploads.putPart(upload, { index: 0, sha256: "a", size: 10 }, new Uint8Array(10));
  }
  await usage.record({ storedBytes: 10 * count, classA: 0, classB: 0 }, T0);
  return { clock, uploads, usage, cleanup: new UploadCleanup({ uploads, usage, clock }) };
}

const meterWith = (cloudflareCalls: number) =>
  new InvocationBudgetMeter({ deadline: T0 + HOUR, cloudflareCalls, externalSubrequests: 0 });

describe("UploadCleanup (GROKCHAT-20)", () => {
  it("deletes expired uploads with their parts, gives their bytes back, and spends its cost", async () => {
    const { uploads, usage, cleanup } = await setup(3);
    const meter = new InvocationBudgetMeter(invocationBudget(T0 + HOUR));
    expect(await cleanup.run(meter)).toBe(3);
    expect(uploads.entries.size).toBe(0);
    expect(meter.remaining().cloudflareCalls).toBe(1000 - QUERY - 3 * ITEM);
    expect(await usage.current(T0)).toStrictEqual({
      month: "2026-10",
      storedBytes: 0,
      classA: 4,
      classB: 0,
    });
  });

  it("leaves an upload that has not expired", async () => {
    const { uploads, usage, cleanup } = await setup(2, T0 + 1);
    expect(await cleanup.run(meterWith(1000))).toBe(0);
    expect(uploads.entries.size).toBe(2);
    expect(await usage.current(T0)).toStrictEqual({
      month: "2026-10",
      storedBytes: 20,
      classA: 0,
      classB: 0,
    });
  });

  it(`asks for at most ${String(UPLOAD_CLEANUP_BATCH)}, and stops where the meter runs out`, async () => {
    const { uploads, cleanup } = await setup(UPLOAD_CLEANUP_BATCH + 1);
    expect(await cleanup.run(meterWith(1000))).toBe(UPLOAD_CLEANUP_BATCH);
    expect(uploads.entries.size).toBe(1);
    const tight = await setup(3);
    const meter = meterWith(QUERY + 2 * ITEM + ITEM - 1);
    expect(await tight.cleanup.run(meter)).toBe(2);
    expect(await tight.usage.current(T0)).toStrictEqual({
      month: "2026-10",
      storedBytes: 10,
      classA: 3,
      classB: 0,
    });
    expect(meter.remaining().cloudflareCalls).toBe(ITEM - 1);
  });

  it("runs no listing when even the listing does not fit", async () => {
    const { uploads, usage, cleanup } = await setup(1);
    let listed = 0;
    const expired = uploads.expired.bind(uploads);
    uploads.expired = (now, limit) => {
      listed += 1;
      return expired(now, limit);
    };
    const meter = meterWith(QUERY - 1);
    expect(await cleanup.run(meter)).toBe(0);
    expect([listed, meter.remaining().cloudflareCalls]).toStrictEqual([0, QUERY - 1]);
    expect((await usage.current(T0)).classA).toBe(0);
    expect(uploads.entries.size).toBe(1);
    expect(await cleanup.run(meterWith(QUERY))).toBe(0);
    expect(await cleanup.run(meterWith(QUERY + ITEM))).toBe(1);
  });
});

describe("CleanupSteps", () => {
  it("runs each step in order on the same meter and adds up what they deleted", async () => {
    const seen: string[] = [];
    const step = (name: string, deleted: number) => ({
      run: (meter: BudgetMeter) => {
        seen.push(`${name}:${String(meter.remaining().cloudflareCalls)}`);
        meter.spend({ cloudflareCalls: 1, externalSubrequests: 0 });
        return Promise.resolve(deleted);
      },
    });
    const steps = new CleanupSteps([step("media", 2), step("uploads", 3)]);
    expect(await steps.run(meterWith(10))).toBe(5);
    expect(seen).toStrictEqual(["media:10", "uploads:9"]);
    expect(await new CleanupSteps([]).run(meterWith(10))).toBe(0);
  });
});
