import { mediaInUse } from "../../entities/media/media_cleanup";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import { refusal } from "../access/refusal";
import type { Clock } from "../ports/clock";
import type { MediaBlobStore } from "../ports/media_blob_store";
import type { MediaRepository } from "../ports/media_repository";
import type { MediaUsageRepository } from "../ports/media_usage_repository";
import type { PostReader } from "../ports/post_reader";
import type { DeleteMediaInputBoundary } from "./input_boundary";
import type { DeleteMediaInputData } from "./input_data";
import type { DeleteMediaOutputBoundary } from "./output_boundary";
import type { DeleteMediaOutputData } from "./output_data";

export interface DeleteMediaPorts {
  readonly media: MediaRepository;
  readonly reader: PostReader;
  readonly blobs: MediaBlobStore;
  readonly usage: MediaUsageRepository;
  readonly guard: AccessGuard;
  readonly audit: ActionAudit;
  readonly clock: Clock;
}

/**
 * The Media page deletes an unused item (GROKCHAT-18): human only, never one a live post holds;
 * the bytes, their stored size in the quota and the row go as the cleanup removes them.
 */
export class DeleteMediaInteractor implements DeleteMediaInputBoundary {
  constructor(
    private readonly ports: DeleteMediaPorts,
    private readonly presenter: DeleteMediaOutputBoundary,
  ) {}

  async execute(input: DeleteMediaInputData): Promise<void> {
    this.presenter.present(await this.remove(input));
  }

  private async remove(input: DeleteMediaInputData): Promise<DeleteMediaOutputData> {
    const media = await this.ports.media.get(input.mediaId);
    if (media === null) {
      return refusal("not_found");
    }
    const action = {
      actor: input.actor,
      action: "media.delete",
      accountId: media.ownerAccountId,
      postId: media.attachedTo,
    };
    if (!(await this.ports.guard.humanOnly(action))) {
      return refusal("human_only");
    }
    const post = media.attachedTo === null ? null : await this.ports.reader.get(media.attachedTo);
    if (mediaInUse(post)) {
      await this.ports.audit.refused(action, "media_in_use");
      return refusal("media_in_use");
    }
    await this.ports.blobs.delete(media.storageKey);
    const now = this.ports.clock.now();
    await this.ports.usage.record({ storedBytes: -media.size, classA: 0, classB: 0 }, now);
    await this.ports.media.delete(media.id);
    await this.ports.audit.done(action, media.id);
    return { ok: true, accountId: media.ownerAccountId };
  }
}
