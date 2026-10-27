import type { AccountId, PostId, StagedMediaId, XMediaId } from "../../entities/identity/ids";
import { canRead } from "../../entities/media/r2_quota";
import type { Instant } from "../../entities/time/instant";
import { mapXOutcome, type XOutcome } from "../../entities/x/x_outcome";
import type { MediaBlobStore } from "../ports/media_blob_store";
import type { MediaRepository } from "../ports/media_repository";
import type { MediaUsageRepository } from "../ports/media_usage_repository";
import type { XMediaUploader } from "../ports/x_media_uploader";
import type { CallAccount, XCallRecorder } from "./x_call_recorder";

export type StageResult =
  | { readonly ok: true; readonly ids: readonly XMediaId[] }
  | { readonly ok: false; readonly outcome: XOutcome };

export interface MediaStagerPorts {
  readonly media: MediaRepository;
  readonly blobs: MediaBlobStore;
  readonly usage: MediaUsageRepository;
  readonly uploader: XMediaUploader;
  readonly recorder: XCallRecorder;
}

/** Uploads a part's staged media to X just before the part is sent (plan §3.3 #4). */
export class MediaStager {
  constructor(private readonly ports: MediaStagerPorts) {}

  async stage(
    account: CallAccount,
    post: PostId,
    ids: readonly StagedMediaId[],
    now: Instant,
  ): Promise<StageResult> {
    const uploaded: XMediaId[] = [];
    for (const id of ids) {
      const result = await this.stageOne(account, post, id, now);
      if (!result.ok) {
        return result;
      }
      uploaded.push(result.id);
    }
    return { ok: true, ids: uploaded };
  }

  private async stageOne(
    account: CallAccount,
    post: PostId,
    id: StagedMediaId,
    now: Instant,
  ): Promise<
    | { readonly ok: true; readonly id: XMediaId }
    | { readonly ok: false; readonly outcome: XOutcome }
  > {
    const bytes = await this.read(account.id, id, now);
    if (typeof bytes === "string") {
      return { ok: false, outcome: { kind: "rejected", reason: bytes } };
    }
    const result = await this.ports.uploader.upload(account.id, bytes.data, bytes.kind);
    await this.ports.recorder.record({
      account,
      operation: { kind: "media_upload" },
      billed: true,
      outcome: result.ok ? "uploaded" : `failed: ${result.failure.kind}`,
      postId: post,
      at: now,
    });
    return result.ok
      ? { ok: true, id: result.value }
      : { ok: false, outcome: mapXOutcome(result.failure, now) };
  }

  /** The bytes, or why they cannot be read: missing, someone else's, or over the R2 read quota. */
  private async read(
    account: AccountId,
    id: StagedMediaId,
    now: Instant,
  ): Promise<{ readonly data: Uint8Array; readonly kind: "PHOTO" | "GIF" } | string> {
    const media = await this.ports.media.get(id);
    if (media?.ownerAccountId !== account) {
      return "media_missing";
    }
    if (!canRead(await this.ports.usage.current(now), now).allowed) {
      return "media_quota";
    }
    const data = await this.ports.blobs.get(media.storageKey);
    if (data === null) {
      return "media_missing";
    }
    await this.ports.usage.record({ storedBytes: 0, classA: 0, classB: 1 }, now);
    return { data, kind: media.kind };
  }
}
