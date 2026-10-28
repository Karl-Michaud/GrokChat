/** `upload_media` parts sent at the same time (GROKCHAT-20): one assembly, every byte counted once. */
import { describe, expect, it } from "vitest";
import { stagedMediaId } from "../../../src/entities/identity/ids";
import { ASSEMBLY_LEASE } from "../../../src/entities/media/upload_parts";
import { MemoryPendingUploads } from "../../../src/frameworks/memory/memory_pending_uploads";
import { PartUpload } from "../../../src/use_cases/media/part_upload";
import type { PendingUpload, StoredPart } from "../../../src/use_cases/ports/pending_uploads";
import { T0 } from "../support/builders";
import { JPEG, part, PARTS, send, usageAt, world0 } from "../support/upload_sender";
import { PNG, type World } from "../support/world";

describe("upload_media: parts sent at the same time (GROKCHAT-20)", () => {
  it("the last two parts sent together stage the file once, with every part counted once", async () => {
    const world = await world0();
    await part(world, 0, null);
    const answers = await Promise.all([part(world, 1, "id-1"), part(world, 2, "id-1")]);
    expect(answers.filter((answer) => answer.ok && answer.complete)).toStrictEqual([
      {
        ok: true,
        complete: true,
        mediaId: stagedMediaId("id-2"),
        kind: "PHOTO",
        size: JPEG.length,
        uploadId: "id-1",
      },
    ]);
    // The other call saw every part in but lost the claim: nothing is missing, the file is coming.
    expect(answers.filter((answer) => answer.ok && !answer.complete)).toStrictEqual([
      { ok: true, complete: false, uploadId: "id-1", missing: [] },
    ]);
    expect([...world.media.rows.keys()]).toStrictEqual([stagedMediaId("id-2")]);
    expect((await usageAt(world)).storedBytes).toBe(JPEG.length);
    const done = answers.find((answer) => answer.ok && answer.complete);
    const again = await Promise.all([part(world, 1, "id-1"), part(world, 2, "id-1")]);
    expect(again).toStrictEqual([done, done]);
    expect(world.media.rows.size).toBe(1);
    expect((await usageAt(world)).storedBytes).toBe(JPEG.length);
  });

  it("every part sent together after the first: one media row, one complete answer", async () => {
    const world = await world0();
    const bytes = new Uint8Array([...JPEG, ...JPEG]);
    const pieces = [0, 6, 12, 18, 24, 30, 36].map((at) => bytes.slice(at, at + 6));
    const fileSha256 = await world.hasher.sha256Hex(bytes);
    const input = (index: number, uploadId: string | null) => ({
      uploadId,
      partIndex: index,
      partCount: pieces.length + 1,
      fileSha256,
    });
    const last = bytes.slice(42);
    await send({ world, bytes: last, input: input(pieces.length, null) });
    const answers = await Promise.all(
      pieces.map((piece, index) => send({ world, bytes: piece, input: input(index, "id-1") })),
    );
    expect(answers.filter((answer) => answer.ok && answer.complete)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok)).toStrictEqual([]);
    expect(world.media.rows.size).toBe(1);
    expect(await world.blobs.get("blob-1")).toStrictEqual(bytes);
    expect((await usageAt(world)).storedBytes).toBe(bytes.length);
  });

  it("a claim left by a Worker that died blocks assembly only until its lease runs out", async () => {
    const world = await world0();
    await part(world, 0, null);
    await part(world, 1, "id-1");
    expect(await world.uploads.claim("id-1", T0, T0 + ASSEMBLY_LEASE)).toBe(true);
    const waiting = { ok: true, complete: false, uploadId: "id-1", missing: [] };
    expect(await part(world, 2, "id-1")).toStrictEqual(waiting);
    world.clock.advance(ASSEMBLY_LEASE - 1);
    expect(await part(world, 2, "id-1")).toStrictEqual(waiting);
    world.clock.advance(1);
    expect(await part(world, 2, "id-1")).toMatchObject({ ok: true, complete: true });
    expect(world.media.rows.size).toBe(1);
  });

  /** Pending uploads where another call finishes (or discards) the upload as part 2 is written. */
  function racing(world: World, after: (store: MemoryPendingUploads, id: string) => Promise<void>) {
    class Racing extends MemoryPendingUploads {
      override async putPart(upload: PendingUpload, stored: StoredPart, bytes: Uint8Array) {
        await super.putPart(upload, stored, bytes);
        if (stored.index === 2) {
          await after(this, upload.id);
        }
      }
    }
    const uploads = new Racing();
    const parts = new PartUpload({ ...world, uploads });
    return (index: number, uploadId: string | null) =>
      send({
        world,
        bytes: PARTS[index] ?? PNG,
        input: { uploadId, partIndex: index, partCount: 3 },
        parts,
      });
  }

  it("a part whose upload another call staged meanwhile answers with that media", async () => {
    const world = await world0();
    const earlier = await send({ world, bytes: JPEG });
    const one = racing(world, (store, id) => store.finish(id, stagedMediaId("id-1")));
    await one(0, null);
    await one(1, "id-2");
    expect(await one(2, "id-2")).toStrictEqual({ ...earlier, uploadId: "id-2" });
    expect(world.media.rows.size).toBe(1);
  });

  it("a part that sees the staging call's delete half done answers with that media", async () => {
    const world = await world0();
    const earlier = await send({ world, bytes: JPEG });
    const one = racing(world, (store, id) => {
      const entry = store.entries.get(id);
      if (entry !== undefined) {
        entry.upload = { ...entry.upload, mediaId: stagedMediaId("id-1") };
        entry.parts.delete(0);
      }
      return Promise.resolve();
    });
    await one(0, null);
    await one(1, "id-2");
    expect(await one(2, "id-2")).toStrictEqual({ ...earlier, uploadId: "id-2" });
  });

  it("a part whose upload another call discarded meanwhile is upload_not_found", async () => {
    const world = await world0();
    const one = racing(world, (store, id) => store.discard(id));
    await one(0, null);
    await one(1, "id-1");
    expect(await one(2, "id-1")).toStrictEqual({ ok: false, code: "upload_not_found" });
    expect(world.media.rows.size).toBe(0);
  });
});
