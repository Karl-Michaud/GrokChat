/** The PendingUploads / ExpiredUploads contract (GROKCHAT-20): every driver passes it. */
import { expect, it } from "vitest";
import { stagedMediaId } from "../../src/entities/identity/ids";
import type { ExpiredUploads } from "../../src/use_cases/ports/expired_uploads";
import type { PendingUpload, PendingUploads } from "../../src/use_cases/ports/pending_uploads";
import { ACCOUNT, T0 } from "../unit/support/builders";

export type UploadStore = PendingUploads & ExpiredUploads;

export const anUpload = (overrides: Partial<PendingUpload> = {}): PendingUpload => ({
  id: "up-1",
  accountId: ACCOUNT,
  fileSha256: "ab".repeat(32),
  partCount: 3,
  label: "mascot",
  expiresAt: T0,
  mediaId: null,
  ...overrides,
});

const bytes = (...values: number[]) => new Uint8Array(values);

export function pendingUploadsContract(make: () => UploadStore): void {
  it("open then get returns the upload as opened; an unknown id is null", async () => {
    const store = make();
    const upload = anUpload();
    await store.open(upload);
    expect(await store.get("up-1")).toStrictEqual(upload);
    await store.open(anUpload({ id: "up-2", label: null }));
    expect(await store.get("up-2")).toStrictEqual(anUpload({ id: "up-2", label: null }));
    expect(await store.get("never")).toBeNull();
  });

  it("keeps each part's bytes, hash and size by index; writing an index again replaces it", async () => {
    const store = make();
    const upload = anUpload();
    await store.open(upload);
    expect(await store.parts("up-1")).toStrictEqual([]);
    await store.putPart(upload, { index: 2, sha256: "c", size: 1 }, bytes(9));
    await store.putPart(upload, { index: 0, sha256: "a", size: 2 }, bytes(1, 2));
    await store.putPart(upload, { index: 10, sha256: "k", size: 1 }, bytes(7));
    await store.putPart(upload, { index: 0, sha256: "a2", size: 3 }, bytes(4, 5, 6));
    expect(await store.parts("up-1")).toStrictEqual([
      { index: 0, sha256: "a2", size: 3 },
      { index: 2, sha256: "c", size: 1 },
      { index: 10, sha256: "k", size: 1 },
    ]);
    expect(await store.readPart("up-1", 0)).toStrictEqual(bytes(4, 5, 6));
    expect(await store.readPart("up-1", 2)).toStrictEqual(bytes(9));
    expect(await store.readPart("up-1", 1)).toBeNull();
    expect(await store.readPart("never", 0)).toBeNull();
  });

  it("finish deletes the parts and keeps the upload with its media", async () => {
    const store = make();
    const upload = anUpload();
    await store.open(upload);
    await store.putPart(upload, { index: 0, sha256: "a", size: 1 }, bytes(1));
    await store.finish("up-1", stagedMediaId("m-1"));
    expect(await store.get("up-1")).toStrictEqual({ ...upload, mediaId: "m-1" });
    expect(await store.parts("up-1")).toStrictEqual([]);
    await store.finish("never", stagedMediaId("m-2"));
    expect(await store.get("never")).toBeNull();
  });

  it("claim: one holder until its lease runs out or it unclaims; never a staged or unknown upload", async () => {
    const store = make();
    const upload = anUpload();
    await store.open(upload);
    await store.putPart(upload, { index: 0, sha256: "a", size: 1 }, bytes(1));
    expect(await store.claim("never", T0, T0 + 10)).toBe(false);
    expect(await store.claim("up-1", T0, T0 + 10)).toBe(true);
    expect(await store.claim("up-1", T0, T0 + 10)).toBe(false);
    expect(await store.claim("up-1", T0 + 9, T0 + 20)).toBe(false);
    // The claim changes nothing a reader sees.
    expect(await store.get("up-1")).toStrictEqual(upload);
    expect(await store.parts("up-1")).toStrictEqual([{ index: 0, sha256: "a", size: 1 }]);
    expect(await store.claim("up-1", T0 + 10, T0 + 20)).toBe(true);
    await store.unclaim("up-1");
    expect(await store.get("up-1")).toStrictEqual(upload);
    expect(await store.claim("up-1", T0 + 11, T0 + 20)).toBe(true);
    await store.finish("up-1", stagedMediaId("m-1"));
    expect(await store.claim("up-1", T0 + 30, T0 + 40)).toBe(false);
    await store.unclaim("up-1");
    expect(await store.claim("up-1", T0 + 30, T0 + 40)).toBe(false);
    expect(await store.get("up-1")).toStrictEqual({ ...upload, mediaId: "m-1" });
    await store.unclaim("never");
    expect(await store.get("never")).toBeNull();
  });

  it("of claims made at the same time exactly one wins", async () => {
    const store = make();
    await store.open(anUpload());
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => store.claim("up-1", T0, T0 + 10)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("discard deletes the upload and its parts, and no other upload's", async () => {
    const store = make();
    const one = anUpload();
    const two = anUpload({ id: "up-10" });
    for (const upload of [one, two]) {
      await store.open(upload);
      await store.putPart(upload, { index: 0, sha256: "a", size: 1 }, bytes(1));
    }
    await store.discard("up-1");
    expect([await store.get("up-1"), await store.parts("up-1")]).toStrictEqual([null, []]);
    expect(await store.parts("up-10")).toHaveLength(1);
    await store.discard("never");
  });

  it("expired lists uploads whose expiry is at or before now, with their parts' bytes", async () => {
    const store = make();
    const due = anUpload({ id: "up-a", expiresAt: T0 });
    const later = anUpload({ id: "up-b", expiresAt: T0 + 1 });
    const done = anUpload({ id: "up-c", expiresAt: T0 - 5 });
    for (const upload of [due, later, done]) {
      await store.open(upload);
    }
    await store.putPart(due, { index: 0, sha256: "a", size: 3 }, bytes(1, 2, 3));
    await store.putPart(due, { index: 1, sha256: "b", size: 2 }, bytes(4, 5));
    await store.putPart(later, { index: 0, sha256: "a", size: 1 }, bytes(1));
    await store.finish("up-c", stagedMediaId("m"));
    const found = await store.expired(T0, 10);
    expect([...found].sort((a, b) => a.id.localeCompare(b.id))).toStrictEqual([
      { id: "up-a", partBytes: 5 },
      { id: "up-c", partBytes: 0 },
    ]);
    expect(await store.expired(T0, 1)).toHaveLength(1);
    expect(await store.expired(T0 - 6, 10)).toStrictEqual([]);
  });
}
