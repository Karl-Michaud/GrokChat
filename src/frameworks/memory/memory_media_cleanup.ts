import type { StagedMedia } from "../../entities/content/staged_media";
import { mediaCleanupDue } from "../../entities/media/media_cleanup";
import type { Instant } from "../../entities/time/instant";
import type { MediaCleanupCandidates } from "../../use_cases/ports/media_cleanup_candidates";
import type { MediaRepository } from "../../use_cases/ports/media_repository";
import type { PostReader } from "../../use_cases/ports/post_reader";

const byStagedThenId = (a: StagedMedia, b: StagedMedia): number =>
  a.stagedAt - b.stagedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The in-memory candidates: every item through the entity policy, against its post. */
export class MemoryMediaCleanupCandidates implements MediaCleanupCandidates {
  constructor(
    private readonly media: MediaRepository,
    private readonly reader: PostReader,
  ) {}

  async due(now: Instant, limit: number): Promise<readonly StagedMedia[]> {
    const due: StagedMedia[] = [];
    for (const item of await this.media.list()) {
      const post = item.attachedTo === null ? null : await this.reader.get(item.attachedTo);
      if (mediaCleanupDue(item, post, now)) {
        due.push(item);
      }
    }
    return due.sort(byStagedThenId).slice(0, Math.max(0, limit));
  }
}
