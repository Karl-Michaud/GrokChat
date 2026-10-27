/**
 * The R2 blob store against its contract, and the R2 quota guard and staged-media cleanup run on
 * the real drivers (D1 usage and metadata, R2 bytes; plan §3.5, U17).
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { R2_GUARDS } from "../../src/entities/media/r2_quota";
import { DAY, HOUR } from "../../src/entities/time/instant";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { ManualClock, SequentialIds } from "../../src/frameworks/memory/manual_clock";
import { FnvContentHasher } from "../../src/frameworks/memory/memory_media";
import { MemoryAuditLog } from "../../src/frameworks/memory/memory_records";
import { R2MediaBlobStore } from "../../src/frameworks/r2/r2_media_blob_store";
import { ActionAudit } from "../../src/use_cases/access/action_audit";
import { MediaAttachments } from "../../src/use_cases/authoring/media_attachments";
import { MediaIntake } from "../../src/use_cases/media/media_intake";
import { invocationBudget } from "../../src/entities/budget/budget";
import { InvocationBudgetMeter } from "../../src/frameworks/budget/invocation_meter";
import { MediaCleanup } from "../../src/use_cases/run_services/media_cleanup";
import { MediaStager } from "../../src/use_cases/run_services/media_stager";
import { XCallRecorder } from "../../src/use_cases/run_services/x_call_recorder";
import { FakeXMediaUploader, FakeXWorld } from "../../src/frameworks/memory/fake_x";
import { freshStorage } from "../integration/support/fresh_d1";
import { aPost, anAccount, HUMAN, part, sentState, T0 } from "../unit/support/builders";
import { required } from "../unit/support/publishing";
import { PNG } from "../unit/support/world";
import { blobStoreContract } from "./repositories.contract";

beforeEach(freshStorage);

describe("R2MediaBlobStore", () => {
  blobStoreContract(() => new R2MediaBlobStore(env.MEDIA));

  it("keeps the content type and puts every key under media/", async () => {
    const store = new R2MediaBlobStore(env.MEDIA);
    const key = await store.put(PNG, "image/png");
    expect(key).toMatch(/^media\/[0-9a-f-]{36}$/);
    expect((await env.MEDIA.head(key))?.httpMetadata?.contentType).toBe("image/png");
  });
});

function media() {
  const clock = new ManualClock(T0);
  const stores = d1Stores(env.DB);
  const blobs = new R2MediaBlobStore(env.MEDIA);
  const intake = new MediaIntake({
    media: stores.media,
    blobs,
    usage: stores.usage,
    hasher: new FnvContentHasher(),
    audit: new ActionAudit(new MemoryAuditLog(), clock),
    ids: new SequentialIds("m"),
    clock,
  });
  const x = new FakeXWorld(clock);
  const stager = new MediaStager({
    media: stores.media,
    blobs,
    usage: stores.usage,
    uploader: new FakeXMediaUploader(x),
    recorder: new XCallRecorder(stores.audit, stores.costs),
  });
  const cleanup = new MediaCleanup({
    media: stores.media,
    candidates: stores.cleanupCandidates,
    blobs,
    usage: stores.usage,
    clock,
  });
  return { clock, stores, blobs, intake, stager, cleanup };
}

const objects = async (): Promise<number> => (await env.MEDIA.list()).objects.length;

describe("the R2 quota guard on the real drivers", () => {
  it("an upload is counted (bytes, Class A) and refused once it would pass 8 GB", async () => {
    const { intake, stores } = media();
    const account = anAccount();
    expect(await intake.store(HUMAN, account, PNG)).toMatchObject({ ok: true });
    expect(await stores.usage.current(T0)).toStrictEqual({
      month: "2026-10",
      storedBytes: PNG.length,
      classA: 1,
      classB: 0,
    });
    const room = R2_GUARDS.storedBytes - PNG.length;
    await stores.usage.record({ storedBytes: room - PNG.length + 1, classA: 0, classB: 0 }, T0);
    expect(await intake.store(HUMAN, account, PNG)).toStrictEqual({
      ok: false,
      code: "media_quota",
    });
    expect(await objects()).toBe(1);
  });

  it("uploads stop at 800k Class A operations this month, and start again next month", async () => {
    const { intake, stores } = media();
    await stores.usage.record({ storedBytes: 0, classA: R2_GUARDS.classA, classB: 0 }, T0);
    expect(await intake.store(HUMAN, anAccount(), PNG)).toStrictEqual({
      ok: false,
      code: "media_quota",
    });
    const november = Date.UTC(2026, 10, 1);
    const next = media();
    next.clock.set(november);
    expect(await next.intake.store(HUMAN, anAccount(), PNG)).toMatchObject({ ok: true });
  });

  it("reads stop at 8M Class B: the part is refused, nothing is read or uploaded", async () => {
    const { intake, stager, stores } = media();
    const stored = await intake.store(HUMAN, anAccount(), PNG);
    if (!stored.ok) {
      throw new Error("staging failed");
    }
    const staged = await stager.stage(anAccount(), aPost().id, [stored.mediaId], T0);
    expect(staged.ok).toBe(true);
    expect((await stores.usage.current(T0)).classB).toBe(1);
    await stores.usage.record({ storedBytes: 0, classA: 0, classB: R2_GUARDS.classB - 1 }, T0);
    expect(await stager.stage(anAccount(), aPost().id, [stored.mediaId], T0)).toStrictEqual({
      ok: false,
      outcome: { kind: "rejected", reason: "media_quota" },
    });
    expect((await stores.usage.current(T0)).classB).toBe(R2_GUARDS.classB);
  });
});

describe("staged-media cleanup on the real drivers", () => {
  it("deletes unused media after 2 days and used media 7 days after its post was sent", async () => {
    const { intake, cleanup, stores, clock } = media();
    const at = (now: number) => {
      clock.set(now);
      return cleanup.run(new InvocationBudgetMeter(invocationBudget(now + HOUR)));
    };
    const unused = await intake.store(HUMAN, anAccount(), PNG);
    const used = await intake.store(HUMAN, anAccount(), PNG);
    if (!unused.ok || !used.ok) {
      throw new Error("staging failed");
    }
    const post = aPost({
      lifecycle: "DONE",
      parts: [part("p", sentState("x", T0 + HOUR), [used.mediaId])],
    });
    await stores.writer.add(post);
    await new MediaAttachments(stores.media).replace(post.id, [
      required(await stores.media.get(used.mediaId)),
    ]);
    expect(await at(T0 + 2 * DAY - 1)).toBe(0);
    expect(await at(T0 + 2 * DAY)).toBe(1);
    expect(await stores.media.get(unused.mediaId)).toBeNull();
    expect(await objects()).toBe(1);
    expect(await at(T0 + HOUR + 7 * DAY - 1)).toBe(0);
    expect(await at(T0 + HOUR + 7 * DAY)).toBe(1);
    expect(await objects()).toBe(0);
    expect((await stores.usage.current(T0 + 8 * DAY)).storedBytes).toBe(0);
  });
});
