import { accountId, stagedMediaId, type StagedMediaId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type { ExpiredUpload, ExpiredUploads } from "../../use_cases/ports/expired_uploads";
import type {
  PendingUpload,
  PendingUploads,
  StoredPart,
} from "../../use_cases/ports/pending_uploads";

/** Every pending upload's objects sit under this prefix, apart from the staged media's `media/`. */
export const UPLOADS_PREFIX = "uploads/";
/** The expiry sweep reads at most this many listing pages per tick (`UPLOAD_CLEANUP_QUERY_COST`). */
export const MAX_SWEEP_PAGES = 5;

const uploadKey = (id: string): string => `${UPLOADS_PREFIX}${id}/upload`;
const partsPrefix = (id: string): string => `${UPLOADS_PREFIX}${id}/part/`;
const partKey = (id: string, index: number): string => `${partsPrefix(id)}${String(index)}`;

interface UploadRecord {
  readonly accountId: string;
  readonly fileSha256: string;
  readonly partCount: number;
  readonly label: string | null;
  readonly expiresAt: number;
  readonly mediaId: string | null;
}

function record(upload: PendingUpload): UploadRecord {
  const { accountId: account, fileSha256, partCount, label, expiresAt, mediaId } = upload;
  return { accountId: account, fileSha256, partCount, label, expiresAt, mediaId };
}

function fromRecord(id: string, stored: UploadRecord): PendingUpload {
  return {
    id,
    accountId: accountId(stored.accountId),
    fileSha256: stored.fileSha256,
    partCount: stored.partCount,
    label: stored.label,
    expiresAt: stored.expiresAt,
    mediaId: stored.mediaId === null ? null : stagedMediaId(stored.mediaId),
  };
}

/** Every object every expiry sweep reads: when its upload expires (ms since the epoch). */
const expiryMetadata = (upload: PendingUpload): Record<string, string> => ({
  expires: String(upload.expiresAt),
});

/**
 * Pending `upload_media` parts in the private R2 bucket (GROKCHAT-20), so no D1 table is needed:
 * `uploads/<id>/upload` holds the upload as JSON, `uploads/<id>/part/<index>` each part's bytes
 * with its SHA-256 in custom metadata. Every object carries its upload's expiry, which the sweep
 * reads from the listing alone.
 */
export class R2PendingUploads implements PendingUploads, ExpiredUploads {
  constructor(private readonly bucket: R2Bucket) {}

  async open(upload: PendingUpload): Promise<void> {
    await this.bucket.put(uploadKey(upload.id), JSON.stringify(record(upload)), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: expiryMetadata(upload),
    });
  }

  async get(id: string): Promise<PendingUpload | null> {
    const object = await this.bucket.get(uploadKey(id));
    return object === null ? null : fromRecord(id, await object.json<UploadRecord>());
  }

  async putPart(upload: PendingUpload, part: StoredPart, bytes: Uint8Array): Promise<void> {
    await this.bucket.put(partKey(upload.id, part.index), bytes, {
      customMetadata: { ...expiryMetadata(upload), sha256: part.sha256 },
    });
  }

  async parts(id: string): Promise<readonly StoredPart[]> {
    const prefix = partsPrefix(id);
    const objects = await this.listAll(prefix);
    return objects
      .map((object) => ({
        index: Number(object.key.slice(prefix.length)),
        sha256: object.customMetadata?.["sha256"] ?? "",
        size: object.size,
      }))
      .sort((a, b) => a.index - b.index);
  }

  async readPart(id: string, index: number): Promise<Uint8Array | null> {
    const object = await this.bucket.get(partKey(id, index));
    return object === null ? null : new Uint8Array(await object.arrayBuffer());
  }

  async finish(id: string, mediaId: StagedMediaId): Promise<void> {
    const upload = await this.get(id);
    if (upload !== null) {
      await this.open({ ...upload, mediaId });
    }
    await this.deleteUnder(partsPrefix(id));
  }

  async discard(id: string): Promise<void> {
    await this.deleteUnder(`${UPLOADS_PREFIX}${id}/`);
  }

  async expired(now: Instant, limit: number): Promise<readonly ExpiredUpload[]> {
    const { objects, complete } = await this.sweepListing();
    const groups = new Map<string, { expired: boolean; partBytes: number }>();
    for (const object of objects) {
      const id = object.key.slice(UPLOADS_PREFIX.length).split("/")[0] ?? "";
      const group = groups.get(id) ?? { expired: false, partBytes: 0 };
      const expires = Number(object.customMetadata?.["expires"] ?? 0);
      group.expired ||= !(expires > now);
      group.partBytes += object.key.startsWith(partsPrefix(id)) ? object.size : 0;
      groups.set(id, group);
    }
    if (!complete) {
      // The last upload listed may go on past the last page read: its bytes are counted next tick.
      groups.delete([...groups.keys()].at(-1) ?? "");
    }
    return [...groups.entries()]
      .filter(([, group]) => group.expired)
      .slice(0, limit)
      .map(([id, group]) => ({ id, partBytes: group.partBytes }));
  }

  private async sweepListing(): Promise<{ objects: readonly R2Object[]; complete: boolean }> {
    const objects: R2Object[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SWEEP_PAGES; page += 1) {
      const listed = await this.bucket.list({
        prefix: UPLOADS_PREFIX,
        include: ["customMetadata"],
        ...(cursor === undefined ? {} : { cursor }),
      });
      objects.push(...listed.objects);
      if (!listed.truncated) {
        return { objects, complete: true };
      }
      cursor = listed.cursor;
    }
    return { objects, complete: false };
  }

  private async listAll(prefix: string): Promise<readonly R2Object[]> {
    const objects: R2Object[] = [];
    let cursor: string | undefined;
    do {
      const listed = await this.bucket.list({
        prefix,
        include: ["customMetadata"],
        ...(cursor === undefined ? {} : { cursor }),
      });
      objects.push(...listed.objects);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor !== undefined);
    return objects;
  }

  private async deleteUnder(prefix: string): Promise<void> {
    const keys = (await this.listAll(prefix)).map((object) => object.key);
    if (keys.length > 0) {
      await this.bucket.delete(keys);
    }
  }
}
