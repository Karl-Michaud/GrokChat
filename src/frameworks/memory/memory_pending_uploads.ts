import type { StagedMediaId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type { ExpiredUpload, ExpiredUploads } from "../../use_cases/ports/expired_uploads";
import type {
  PendingUpload,
  PendingUploads,
  StoredPart,
} from "../../use_cases/ports/pending_uploads";

interface Entry {
  upload: PendingUpload;
  readonly parts: Map<number, { readonly part: StoredPart; readonly bytes: Uint8Array }>;
}

/** Pending uploads in memory (tests and the in-process graph), with the R2 driver's contract. */
export class MemoryPendingUploads implements PendingUploads, ExpiredUploads {
  readonly entries = new Map<string, Entry>();

  open(upload: PendingUpload): Promise<void> {
    this.entries.set(upload.id, { upload, parts: new Map() });
    return Promise.resolve();
  }

  get(id: string): Promise<PendingUpload | null> {
    return Promise.resolve(this.entries.get(id)?.upload ?? null);
  }

  putPart(upload: PendingUpload, part: StoredPart, bytes: Uint8Array): Promise<void> {
    const entry = this.entries.get(upload.id) ?? { upload, parts: new Map() };
    entry.parts.set(part.index, { part, bytes: bytes.slice() });
    this.entries.set(upload.id, entry);
    return Promise.resolve();
  }

  parts(id: string): Promise<readonly StoredPart[]> {
    const parts = [...(this.entries.get(id)?.parts.values() ?? [])].map((item) => item.part);
    return Promise.resolve(parts.sort((a, b) => a.index - b.index));
  }

  readPart(id: string, index: number): Promise<Uint8Array | null> {
    return Promise.resolve(this.entries.get(id)?.parts.get(index)?.bytes.slice() ?? null);
  }

  finish(id: string, mediaId: StagedMediaId): Promise<void> {
    const entry = this.entries.get(id);
    if (entry !== undefined) {
      entry.upload = { ...entry.upload, mediaId };
      entry.parts.clear();
    }
    return Promise.resolve();
  }

  discard(id: string): Promise<void> {
    this.entries.delete(id);
    return Promise.resolve();
  }

  expired(now: Instant, limit: number): Promise<readonly ExpiredUpload[]> {
    const due = [...this.entries.values()]
      .filter((entry) => entry.upload.expiresAt <= now)
      .slice(0, limit)
      .map((entry) => ({
        id: entry.upload.id,
        partBytes: [...entry.parts.values()].reduce((sum, item) => sum + item.part.size, 0),
      }));
    return Promise.resolve(due);
  }
}
