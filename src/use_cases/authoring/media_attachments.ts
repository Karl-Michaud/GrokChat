import type { StagedMedia } from "../../entities/content/staged_media";
import type { PostId } from "../../entities/identity/ids";
import type { MediaRepository } from "../ports/media_repository";

/** Which post staged media belongs to: it decides when the media is cleaned up (plan §3.5). */
export class MediaAttachments {
  constructor(private readonly media: MediaRepository) {}

  /** Releases whatever the post held, then attaches `attached` to it. */
  async replace(post: PostId, attached: readonly StagedMedia[]): Promise<void> {
    const held = (await this.media.list()).filter((item) => item.attachedTo === post);
    for (const item of held) {
      await this.media.save({ ...item, attachedTo: null });
    }
    for (const item of attached) {
      await this.media.save({ ...item, attachedTo: post });
    }
  }
}
