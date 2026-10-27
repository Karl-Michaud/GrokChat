import { mediaCleanupDue } from "../../entities/media/media_cleanup";
import type { MediaBlobStore } from "../ports/media_blob_store";
import type { MediaRepository } from "../ports/media_repository";
import type { MediaUsageRepository } from "../ports/media_usage_repository";
import type { PostReader } from "../ports/post_reader";
import type { Instant } from "../../entities/time/instant";

/** Deletes staged media past its retention (plan §3.5); run by the metrics tick. */
export class MediaCleanup {
  constructor(
    private readonly media: MediaRepository,
    private readonly blobs: MediaBlobStore,
    private readonly usage: MediaUsageRepository,
    private readonly reader: PostReader,
  ) {}

  async run(now: Instant): Promise<number> {
    let deleted = 0;
    for (const item of await this.media.list()) {
      const post = item.attachedTo === null ? null : await this.reader.get(item.attachedTo);
      if (mediaCleanupDue(item, post, now)) {
        await this.blobs.delete(item.storageKey);
        await this.usage.record({ storedBytes: -item.size, classA: 0, classB: 0 }, now);
        await this.media.delete(item.id);
        deleted += 1;
      }
    }
    return deleted;
  }
}
