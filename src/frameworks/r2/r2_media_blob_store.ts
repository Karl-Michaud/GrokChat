import type { MediaBlobStore } from "../../use_cases/ports/media_blob_store";

/**
 * Staged-media bytes in the private R2 bucket `grokchat-media` (plan §3.5, U17). Keys are random,
 * so a key never says whose media it is. The quota guard is applied by the callers against the
 * usage kept in D1 (`D1MediaUsage`): uploads (Class A) and reads (Class B) are counted there.
 */
export class R2MediaBlobStore implements MediaBlobStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(bytes: Uint8Array, contentType: string): Promise<string> {
    const key = `media/${crypto.randomUUID()}`;
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } });
    return key;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const object = await this.bucket.get(key);
    return object === null ? null : new Uint8Array(await object.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
