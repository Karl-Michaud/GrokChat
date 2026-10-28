import { canRead } from "../../entities/media/r2_quota";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { Clock } from "../ports/clock";
import type { MediaBlobStore } from "../ports/media_blob_store";
import type { MediaRepository } from "../ports/media_repository";
import type { MediaUsageRepository } from "../ports/media_usage_repository";
import type { GetMediaFileInputBoundary } from "./input_boundary";
import type { GetMediaFileInputData } from "./input_data";
import type { GetMediaFileOutputBoundary } from "./output_boundary";
import type { GetMediaFileOutputData } from "./output_data";

export interface GetMediaFilePorts {
  readonly media: MediaRepository;
  readonly blobs: MediaBlobStore;
  readonly usage: MediaUsageRepository;
  readonly guard: AccessGuard;
  readonly clock: Clock;
}

/**
 * The Media page's thumbnails (GROKCHAT-18): human only, the bytes from R2 as one Class B read
 * under the quota guard, with the type the magic bytes gave when it was staged.
 */
export class GetMediaFileInteractor implements GetMediaFileInputBoundary {
  constructor(
    private readonly ports: GetMediaFilePorts,
    private readonly presenter: GetMediaFileOutputBoundary,
  ) {}

  async execute(input: GetMediaFileInputData): Promise<void> {
    this.presenter.present(await this.read(input));
  }

  private async read(input: GetMediaFileInputData): Promise<GetMediaFileOutputData> {
    const media = await this.ports.media.get(input.mediaId);
    if (media === null) {
      return refusal("not_found");
    }
    const action = {
      actor: input.actor,
      action: "media.view",
      accountId: media.ownerAccountId,
      postId: null,
    };
    if (!(await this.ports.guard.humanOnly(action))) {
      return refusal("human_only");
    }
    const now = this.ports.clock.now();
    if (!canRead(await this.ports.usage.current(now), now).allowed) {
      return refusal("media_quota");
    }
    const bytes = await this.ports.blobs.get(media.storageKey);
    if (bytes === null) {
      return refusal("not_found");
    }
    await this.ports.usage.record({ storedBytes: 0, classA: 0, classB: 1 }, now);
    return { ok: true, bytes, contentType: media.contentType };
  }
}
