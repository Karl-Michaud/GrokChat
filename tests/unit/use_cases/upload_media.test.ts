import { describe, expect, it } from "vitest";
import { stagedMediaId } from "../../../src/entities/identity/ids";
import { MAX_PART_BYTES } from "../../../src/entities/media/upload_parts";
import { HOUR } from "../../../src/entities/time/instant";
import { MemoryPendingUploads } from "../../../src/frameworks/memory/memory_pending_uploads";
import { PartUpload } from "../../../src/use_cases/media/part_upload";
import type { UploadMediaInputData } from "../../../src/use_cases/upload_media/input_data";
import { UploadMediaInteractor } from "../../../src/use_cases/upload_media/interactor";
import type { UploadMediaOutputData } from "../../../src/use_cases/upload_media/output_data";
import { ACCOUNT, botActor, OTHER_ACCOUNT, T0 } from "../support/builders";
import { Capture, makeWorld, PNG, type World } from "../support/world";

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  13, 14,
]);
const PARTS = [JPEG.slice(0, 8), JPEG.slice(8, 16), JPEG.slice(16)];
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

interface Sent {
  readonly world: World;
  readonly bytes: Uint8Array;
  readonly input?: Partial<UploadMediaInputData>;
  readonly parts?: PartUpload;
}

async function send({ world, bytes, input = {}, parts = world.parts }: Sent) {
  const presenter = new Capture<UploadMediaOutputData>();
  const ports = { accounts: world.accounts, guard: world.guard, hasher: world.hasher, parts };
  await new UploadMediaInteractor(ports, presenter).execute({
    actor: botActor(),
    accountId: ACCOUNT,
    label: "",
    fileSha256: await world.hasher.sha256Hex(JPEG),
    data: b64(bytes),
    partSha256: await world.hasher.sha256Hex(bytes),
    uploadId: null,
    partIndex: 0,
    partCount: 1,
    ...input,
  });
  return presenter.last;
}

/** Part `index` of the three-part JPEG upload. */
const part = (world: World, index: number, uploadId: string | null, extra = {}) =>
  send({
    world,
    bytes: PARTS[index] ?? new Uint8Array(),
    input: { uploadId, partIndex: index, partCount: 3, ...extra },
  });

async function world0(): Promise<World> {
  const world = makeWorld();
  await world.seedAccount();
  return world;
}

const usageAt = (world: World) => world.usage.current(T0);

describe("upload_media: a file in one call (GROKCHAT-20)", () => {
  it("stores it through the intake as a bot upload, audited media.bot_upload", async () => {
    const world = await world0();
    const label = "  launch\n mascot ";
    expect(await send({ world, bytes: JPEG, input: { label } })).toStrictEqual({
      ok: true,
      complete: true,
      mediaId: stagedMediaId("id-1"),
      kind: "PHOTO",
      size: JPEG.length,
      uploadId: null,
    });
    expect(world.media.rows.get(stagedMediaId("id-1"))).toMatchObject({
      ownerAccountId: ACCOUNT,
      contentType: "image/jpeg",
      label: "launch mascot",
      source: { kind: "bot_upload" },
      sha256: await world.hasher.sha256Hex(JPEG),
    });
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      ["media.bot_upload", "id-1"],
    ]);
    expect(world.uploads.entries.size).toBe(0);
    expect(await usageAt(world)).toStrictEqual({
      month: "2026-10",
      storedBytes: JPEG.length,
      classA: 1,
      classB: 0,
    });
  });

  it("refuses a file whose sha256 is not its bytes' hash, naming both", async () => {
    const world = await world0();
    expect(await send({ world, bytes: JPEG, input: { fileSha256: "beef" } })).toStrictEqual({
      ok: false,
      code: "file_hash_mismatch",
      part: null,
      expected: "beef",
      actual: await world.hasher.sha256Hex(JPEG),
    });
    expect(world.media.rows.size).toBe(0);
  });

  it("refuses what is not media, too large for its kind, or over the quota", async () => {
    const world = await world0();
    const junk = new Uint8Array([1, 2, 3]);
    const junkSha = await world.hasher.sha256Hex(junk);
    expect(await send({ world, bytes: junk, input: { fileSha256: junkSha } })).toStrictEqual({
      ok: false,
      code: "not_media",
    });
    await world.usage.record({ storedBytes: 8_000_000_000, classA: 0, classB: 0 }, T0);
    expect(await send({ world, bytes: JPEG })).toStrictEqual({ ok: false, code: "media_quota" });
    expect(world.media.rows.size).toBe(0);
  });
});

describe("upload_media: checks on every part (GROKCHAT-20)", () => {
  it("refuses an unknown account and another person's account (scope, audited)", async () => {
    const world = makeWorld();
    expect(await send({ world, bytes: JPEG })).toStrictEqual({ ok: false, code: "not_found" });
    await world.seedAccount({ id: OTHER_ACCOUNT });
    expect(await send({ world, bytes: JPEG, input: { accountId: OTHER_ACCOUNT } })).toStrictEqual({
      ok: false,
      code: "scope",
    });
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      ["refused.media.bot_upload", "scope"],
    ]);
  });

  it.each([
    ["invalid_label", { label: "x".repeat(81) }],
    ["part_out_of_range", { partIndex: 1, partCount: 1 }],
    ["part_out_of_range", { partIndex: 0, partCount: 61 }],
    ["bad_base64", { data: "aGVsbG8" }],
    ["bad_base64", { data: "" }],
    ["bad_base64", { data: "!!!!" }],
  ])("refuses %s (%j) before storing anything", async (code, input) => {
    const world = await world0();
    expect(await send({ world, bytes: JPEG, input })).toStrictEqual({ ok: false, code });
    expect([world.media.rows.size, world.uploads.entries.size]).toStrictEqual([0, 0]);
  });

  it("an 80-character label is kept; a part of exactly 256 KiB is accepted, one byte more refused", async () => {
    const world = await world0();
    const label = "x".repeat(80);
    const big = new Uint8Array(MAX_PART_BYTES);
    big.set(JPEG);
    const input = { label, partCount: 2, fileSha256: "f" };
    expect(await send({ world, bytes: big, input })).toMatchObject({ ok: true, complete: false });
    expect([...world.uploads.entries.values()][0]?.upload.label).toBe(label);
    const over = new Uint8Array(MAX_PART_BYTES + 1);
    expect(await send({ world, bytes: over, input })).toStrictEqual({
      ok: false,
      code: "part_too_large",
    });
  });

  it("refuses a part whose bytes do not hash to part_sha256, naming the part and both hashes", async () => {
    const world = await world0();
    const sent = await part(world, 1, null, { partSha256: "0badc0de" });
    expect(sent).toStrictEqual({
      ok: false,
      code: "part_hash_mismatch",
      part: 1,
      expected: "0badc0de",
      actual: await world.hasher.sha256Hex(PARTS[1] ?? new Uint8Array()),
    });
    expect(world.uploads.entries.size).toBe(0);
  });

  it("accepts base64 wrapped over lines", async () => {
    const world = await world0();
    const data = b64(JPEG).replace(/(.{8})/g, "$1\n");
    expect(await send({ world, bytes: JPEG, input: { data } })).toMatchObject({ complete: true });
  });
});

describe("upload_media: a file in parts (GROKCHAT-20)", () => {
  it("parts in any order: each answer lists what is missing; the last stages the file", async () => {
    const world = await world0();
    const first = await part(world, 2, null, { label: "mascot" });
    expect(first).toStrictEqual({ ok: true, complete: false, uploadId: "id-1", missing: [0, 1] });
    expect(await world.uploads.get("id-1")).toStrictEqual({
      id: "id-1",
      accountId: ACCOUNT,
      fileSha256: await world.hasher.sha256Hex(JPEG),
      partCount: 3,
      label: "mascot",
      expiresAt: T0 + HOUR,
      mediaId: null,
    });
    expect(await part(world, 0, "id-1")).toStrictEqual({
      ok: true,
      complete: false,
      uploadId: "id-1",
      missing: [1],
    });
    expect(await usageAt(world)).toStrictEqual({
      month: "2026-10",
      storedBytes: 16,
      classA: 4,
      classB: 1,
    });
    expect(await part(world, 1, "id-1")).toStrictEqual({
      ok: true,
      complete: true,
      mediaId: stagedMediaId("id-2"),
      kind: "PHOTO",
      size: JPEG.length,
      uploadId: "id-1",
    });
    expect(world.media.rows.get(stagedMediaId("id-2"))).toMatchObject({
      size: JPEG.length,
      label: "mascot",
      source: { kind: "bot_upload" },
      sha256: await world.hasher.sha256Hex(JPEG),
    });
    expect(await world.blobs.get("blob-1")).toStrictEqual(JPEG);
    expect(await world.uploads.parts("id-1")).toStrictEqual([]);
    expect((await world.uploads.get("id-1"))?.mediaId).toBe("id-2");
    // Parts: 3 writes, 2 listings, 2 upload reads, 3 part reads; then the intake's write, the
    // parts' release, and only the file's bytes left stored.
    expect(await usageAt(world)).toStrictEqual({
      month: "2026-10",
      storedBytes: JPEG.length,
      classA: 8,
      classB: 5,
    });
  });

  it("a part resent after the file was staged answers with the same media, staging nothing new", async () => {
    const world = await world0();
    await part(world, 0, null);
    await part(world, 1, "id-1");
    const done = await part(world, 2, "id-1");
    expect(await part(world, 1, "id-1")).toStrictEqual(done);
    expect(world.media.rows.size).toBe(1);
    world.media.rows.clear();
    expect(await part(world, 1, "id-1")).toStrictEqual({ ok: false, code: "upload_not_found" });
  });

  it("resending a part with the same bytes writes nothing; with other bytes replaces it", async () => {
    const world = await world0();
    await part(world, 0, null);
    const before = await usageAt(world);
    expect(await part(world, 0, "id-1")).toStrictEqual({
      ok: true,
      complete: false,
      uploadId: "id-1",
      missing: [1, 2],
    });
    expect(await usageAt(world)).toStrictEqual({
      ...before,
      classA: before.classA + 1,
      classB: before.classB + 1,
    });
    const other = new Uint8Array([9, 9, 9]);
    await send({ world, bytes: other, input: { uploadId: "id-1", partIndex: 0, partCount: 3 } });
    expect(await world.uploads.readPart("id-1", 0)).toStrictEqual(other);
    expect((await usageAt(world)).storedBytes).toBe(3);
  });

  it("a part replaced with other bytes counts once: the stored bytes end as the file's", async () => {
    const world = await world0();
    await part(world, 0, null);
    await send({
      world,
      bytes: new Uint8Array([9]),
      input: { uploadId: "id-1", partIndex: 1, partCount: 3 },
    });
    await part(world, 1, "id-1");
    expect(await part(world, 2, "id-1")).toMatchObject({ ok: true, complete: true });
    expect((await usageAt(world)).storedBytes).toBe(JPEG.length);
  });

  it("an upload_id with part_count 1 is still that upload's part, not a new file", async () => {
    const world = await world0();
    await part(world, 0, null);
    expect(await part(world, 0, "id-1", { partCount: 1 })).toStrictEqual({
      ok: false,
      code: "upload_mismatch",
    });
    expect(world.media.rows.size).toBe(0);
  });

  it("refuses the assembled file when its hash is not sha256, and discards the upload", async () => {
    const world = await world0();
    const fileSha256 = "f00d";
    await part(world, 0, null, { fileSha256 });
    await part(world, 1, "id-1", { fileSha256 });
    expect(await part(world, 2, "id-1", { fileSha256 })).toStrictEqual({
      ok: false,
      code: "file_hash_mismatch",
      part: null,
      expected: "f00d",
      actual: await world.hasher.sha256Hex(JPEG),
    });
    expect(world.uploads.entries.size).toBe(0);
    expect(world.media.rows.size).toBe(0);
    expect((await usageAt(world)).storedBytes).toBe(0);
  });

  it("refuses assembled bytes that are not media, and discards the upload", async () => {
    const world = await world0();
    const junk = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    const fileSha256 = await world.hasher.sha256Hex(new Uint8Array([1, 2, 3, 4]));
    const input = (index: number, uploadId: string | null) => ({
      uploadId,
      partIndex: index,
      partCount: 2,
      fileSha256,
    });
    await send({ world, bytes: junk[0] ?? PNG, input: input(0, null) });
    expect(await send({ world, bytes: junk[1] ?? PNG, input: input(1, "id-1") })).toStrictEqual({
      ok: false,
      code: "not_media",
    });
    expect(world.uploads.entries.size).toBe(0);
    expect((await usageAt(world)).storedBytes).toBe(0);
  });

  it("refuses an unknown upload id, and another account's upload", async () => {
    const world = await world0();
    await world.seedAccount({ id: OTHER_ACCOUNT });
    expect(await part(world, 1, "nope")).toStrictEqual({ ok: false, code: "upload_not_found" });
    await part(world, 0, null);
    const actor = botActor([ACCOUNT, OTHER_ACCOUNT]);
    expect(await part(world, 1, "id-1", { accountId: OTHER_ACCOUNT, actor })).toStrictEqual({
      ok: false,
      code: "upload_not_found",
    });
  });

  it("refuses a part with another sha256 or part_count than the upload was opened with", async () => {
    const world = await world0();
    await part(world, 0, null);
    expect(await part(world, 1, "id-1", { fileSha256: "other" })).toStrictEqual({
      ok: false,
      code: "upload_mismatch",
    });
    expect(await part(world, 1, "id-1", { partCount: 4 })).toStrictEqual({
      ok: false,
      code: "upload_mismatch",
    });
    expect(await world.uploads.parts("id-1")).toHaveLength(1);
  });

  it("refuses a part an hour after the upload opened, and deletes its parts", async () => {
    const world = await world0();
    await part(world, 0, null);
    world.clock.advance(HOUR - 1);
    expect(await part(world, 1, "id-1")).toMatchObject({ ok: true, complete: false });
    world.clock.advance(1);
    expect(await part(world, 2, "id-1")).toStrictEqual({ ok: false, code: "upload_expired" });
    expect(world.uploads.entries.size).toBe(0);
    expect((await world.usage.current(world.clock.now())).storedBytes).toBe(0);
  });

  it("refuses a part over the R2 quota, opening nothing", async () => {
    const world = await world0();
    await world.usage.record({ storedBytes: 8_000_000_000 - 7, classA: 0, classB: 0 }, T0);
    expect(await part(world, 0, null)).toStrictEqual({ ok: false, code: "media_quota" });
    expect(world.uploads.entries.size).toBe(0);
    await world.usage.record({ storedBytes: -1, classA: 0, classB: 0 }, T0);
    expect(await part(world, 0, null)).toMatchObject({ ok: true, uploadId: "id-1" });
    // Part 0 took the last 8 bytes; part 1 (8 more) is over, and is not stored.
    await world.usage.record({ storedBytes: 0, classA: 0, classB: 0 }, T0);
    expect(await part(world, 1, "id-1")).toStrictEqual({ ok: false, code: "media_quota" });
    expect(await world.uploads.parts("id-1")).toHaveLength(1);
  });

  it("a part gone before assembly is reported missing again", async () => {
    const world = await world0();
    class Lossy extends MemoryPendingUploads {
      override readPart(id: string, index: number): Promise<Uint8Array | null> {
        return index === 1 ? Promise.resolve(null) : super.readPart(id, index);
      }
    }
    const uploads = new Lossy();
    const parts = new PartUpload({ ...world, uploads });
    const one = (index: number, uploadId: string | null) =>
      send({
        world,
        bytes: PARTS[index] ?? PNG,
        input: { uploadId, partIndex: index, partCount: 3 },
        parts,
      });
    await one(0, null);
    await one(1, "id-1");
    expect(await one(2, "id-1")).toStrictEqual({
      ok: true,
      complete: false,
      uploadId: "id-1",
      missing: [1],
    });
    expect(world.media.rows.size).toBe(0);
  });
});
