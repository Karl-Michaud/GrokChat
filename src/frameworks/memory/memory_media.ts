import { checkFetchedMedia } from "../../entities/media/fetched_media";
import { monthKey, usageAt, type MediaUsage } from "../../entities/media/r2_quota";
import type { Instant } from "../../entities/time/instant";
import type { ContentHasher } from "../../use_cases/ports/content_hasher";
import type { MediaBlobStore } from "../../use_cases/ports/media_blob_store";
import type { FetchResult, MediaFetcher } from "../../use_cases/ports/media_fetcher";
import type {
  MediaUsageDelta,
  MediaUsageRepository,
} from "../../use_cases/ports/media_usage_repository";

export class MemoryMediaBlobStore implements MediaBlobStore {
  readonly blobs = new Map<string, { readonly bytes: Uint8Array; readonly contentType: string }>();
  private next = 0;

  put(bytes: Uint8Array, contentType: string): Promise<string> {
    this.next += 1;
    const key = `blob-${String(this.next)}`;
    this.blobs.set(key, { bytes, contentType });
    return Promise.resolve(key);
  }

  get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.blobs.get(key)?.bytes ?? null);
  }

  delete(key: string): Promise<void> {
    this.blobs.delete(key);
    return Promise.resolve();
  }
}

export class MemoryMediaUsage implements MediaUsageRepository {
  constructor(private usage: MediaUsage = { month: "", storedBytes: 0, classA: 0, classB: 0 }) {}

  current(now: Instant): Promise<MediaUsage> {
    return Promise.resolve(usageAt(this.usage, now));
  }

  record(delta: MediaUsageDelta, now: Instant): Promise<void> {
    const current = usageAt(this.usage, now);
    this.usage = {
      month: monthKey(now),
      storedBytes: current.storedBytes + delta.storedBytes,
      classA: current.classA + delta.classA,
      classB: current.classB + delta.classB,
    };
    return Promise.resolve();
  }
}

/**
 * Answers each URL from a table: `responses` scripts a result as given; `files` serves bytes that
 * pass the same `checkFetchedMedia` as the real driver. An unknown URL is unreachable.
 */
export class ScriptedMediaFetcher implements MediaFetcher {
  readonly responses = new Map<string, FetchResult>();
  readonly files = new Map<string, Uint8Array>();
  readonly requests: { readonly url: string; readonly maxBytes: number }[] = [];

  fetch(url: string, maxBytes: number, allowedTypes: readonly string[] = []): Promise<FetchResult> {
    this.requests.push({ url, maxBytes });
    const file = this.files.get(url);
    if (file !== undefined) {
      const checked = checkFetchedMedia(file, maxBytes, allowedTypes);
      return Promise.resolve(
        checked.allowed
          ? { ok: true, bytes: file, contentType: checked.media.contentType }
          : { ok: false, reason: checked.reason },
      );
    }
    return Promise.resolve(this.responses.get(url) ?? { ok: false, reason: "unreachable" });
  }
}

/** FNV-1a, hex: deterministic and good enough to tell test files apart (not a real SHA-256). */
export class FnvContentHasher implements ContentHasher {
  sha256Hex(bytes: Uint8Array): Promise<string> {
    let hash = 0x811c9dc5;
    for (const byte of bytes) {
      hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    }
    return Promise.resolve(hash.toString(16).padStart(8, "0"));
  }
}
