import type { StagedMedia } from "../../entities/content/staged_media";
import type { AccountId } from "../../entities/identity/ids";
import type { MediaCatalog } from "../../use_cases/ports/media_catalog";
import type { MediaRepository } from "../../use_cases/ports/media_repository";

const newestFirst = (a: StagedMedia, b: StagedMedia): number =>
  b.stagedAt - a.stagedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** The in-memory catalog: the repository's rows for the account, newest first. */
export class MemoryMediaCatalog implements MediaCatalog {
  constructor(private readonly media: MediaRepository) {}

  async recent(account: AccountId, limit: number): Promise<readonly StagedMedia[]> {
    const rows = (await this.media.list()).filter((item) => item.ownerAccountId === account);
    return [...rows].sort(newestFirst).slice(0, Math.max(0, limit));
  }
}
