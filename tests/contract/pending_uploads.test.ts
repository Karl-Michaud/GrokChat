/**
 * The pending uploads (GROKCHAT-20) against their contract: the in-memory stub and the R2 driver
 * on the local bucket, plus what only R2 has (its key layout, metadata and listing pages).
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryPendingUploads } from "../../src/frameworks/memory/memory_pending_uploads";
import {
  MAX_SWEEP_PAGES,
  R2PendingUploads,
  UPLOADS_PREFIX,
} from "../../src/frameworks/r2/r2_pending_uploads";
import { R2MediaBlobStore } from "../../src/frameworks/r2/r2_media_blob_store";
import { freshStorage } from "../integration/support/fresh_d1";
import { T0 } from "../unit/support/builders";
import { anUpload, pendingUploadsContract } from "./pending_uploads.contract";

beforeEach(freshStorage);

describe("MemoryPendingUploads", () => {
  pendingUploadsContract(() => new MemoryPendingUploads());
});

describe("R2PendingUploads", () => {
  pendingUploadsContract(() => new R2PendingUploads(env.MEDIA));

  it("keeps an upload's objects under uploads/<id>/, each with its expiry, apart from media/", async () => {
    const store = new R2PendingUploads(env.MEDIA);
    const upload = anUpload();
    await store.open(upload);
    await store.putPart(upload, { index: 4, sha256: "h", size: 1 }, new Uint8Array([1]));
    await new R2MediaBlobStore(env.MEDIA).put(new Uint8Array([1]), "image/png");
    const listed = await env.MEDIA.list({ prefix: UPLOADS_PREFIX, include: ["customMetadata"] });
    expect(listed.objects.map((object) => [object.key, object.customMetadata])).toStrictEqual([
      ["uploads/up-1/part/4", { expires: String(T0), sha256: "h" }],
      ["uploads/up-1/upload", { expires: String(T0) }],
    ]);
    expect(await store.expired(T0, 10)).toStrictEqual([{ id: "up-1", partBytes: 1 }]);
  });

  it("a claim rewrites the upload's record with its expiry kept, so the sweep still finds it", async () => {
    const store = new R2PendingUploads(env.MEDIA);
    await store.open(anUpload());
    expect(await store.claim("up-1", T0 - 1, T0 + 60)).toBe(true);
    const object = await env.MEDIA.head(`${UPLOADS_PREFIX}up-1/upload`);
    expect([object?.customMetadata, object?.httpMetadata?.contentType]).toStrictEqual([
      { expires: String(T0) },
      "application/json",
    ]);
    expect(await store.expired(T0, 10)).toStrictEqual([{ id: "up-1", partBytes: 0 }]);
  });

  it("an object without an expiry counts as expired", async () => {
    await env.MEDIA.put(`${UPLOADS_PREFIX}stray/part/0`, new Uint8Array([1, 2]));
    const store = new R2PendingUploads(env.MEDIA);
    expect(await store.expired(T0, 10)).toStrictEqual([{ id: "stray", partBytes: 2 }]);
  });
});

/** A bucket whose listing comes in pages of one object, to reach the sweep's page cap. */
function paged(keys: readonly string[], expires: number): R2Bucket {
  const list = (options?: R2ListOptions) => {
    const at = Number(options?.cursor ?? 0);
    const key = keys[at];
    const objects =
      key === undefined ? [] : [{ key, size: 1, customMetadata: { expires: String(expires) } }];
    const truncated = at + 1 < keys.length;
    return Promise.resolve({
      objects,
      truncated,
      ...(truncated ? { cursor: String(at + 1) } : {}),
      delimitedPrefixes: [],
    } as unknown as R2Objects);
  };
  return { list } as unknown as R2Bucket;
}

describe("R2PendingUploads: the sweep's page cap", () => {
  it(`reads at most ${String(MAX_SWEEP_PAGES)} pages and leaves the upload cut by the last one for the next tick`, async () => {
    const keys = Array.from(
      { length: MAX_SWEEP_PAGES + 2 },
      (_, index) => `${UPLOADS_PREFIX}u${String(Math.floor(index / 2))}/part/${String(index % 2)}`,
    );
    const store = new R2PendingUploads(paged(keys, T0));
    // Pages 1-5 hold u0 (2 objects), u1 (2) and u2's first object: u2 is left out.
    expect(await store.expired(T0, 10)).toStrictEqual([
      { id: "u0", partBytes: 2 },
      { id: "u1", partBytes: 2 },
    ]);
  });

  it("follows every page of one upload's parts", async () => {
    const keys = [`${UPLOADS_PREFIX}u/part/0`, `${UPLOADS_PREFIX}u/part/1`];
    const store = new R2PendingUploads(paged(keys, T0));
    expect((await store.parts("u")).map((part) => part.index)).toStrictEqual([0, 1]);
  });
});
