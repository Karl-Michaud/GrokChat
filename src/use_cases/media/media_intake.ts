import type { Account } from "../../entities/accounts/account";
import { MAX_MEDIA_BYTES, sniffMedia, type MediaKind } from "../../entities/content/staged_media";
import { stagedMediaId, type StagedMediaId } from "../../entities/identity/ids";
import { canStore } from "../../entities/media/r2_quota";
import type { Actor } from "../../entities/identity/actor";
import type { ActionAudit } from "../access/action_audit";
import type { Clock } from "../ports/clock";
import type { ContentHasher } from "../ports/content_hasher";
import type { IdGenerator } from "../ports/id_generator";
import type { MediaBlobStore } from "../ports/media_blob_store";
import type { MediaRepository } from "../ports/media_repository";
import type { MediaUsageRepository } from "../ports/media_usage_repository";

export type IntakeRefusalCode = "not_media" | "too_large" | "media_quota";

export type IntakeResult =
  | {
      readonly ok: true;
      readonly mediaId: StagedMediaId;
      readonly kind: MediaKind;
      readonly size: number;
    }
  | { readonly ok: false; readonly code: IntakeRefusalCode };

export interface MediaIntakePorts {
  readonly media: MediaRepository;
  readonly blobs: MediaBlobStore;
  readonly usage: MediaUsageRepository;
  readonly hasher: ContentHasher;
  readonly audit: ActionAudit;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Stores fetched or uploaded bytes as staged media: the kind from the magic bytes, X's size limit
 * for that kind, and the R2 quota guard before the write (plan §3.3 #3, §3.5).
 */
export class MediaIntake {
  constructor(private readonly ports: MediaIntakePorts) {}

  async store(actor: Actor, account: Account, bytes: Uint8Array): Promise<IntakeResult> {
    const sniffed = sniffMedia(bytes);
    if (sniffed === null) {
      return { ok: false, code: "not_media" };
    }
    if (bytes.length > MAX_MEDIA_BYTES[sniffed.kind]) {
      return { ok: false, code: "too_large" };
    }
    const now = this.ports.clock.now();
    if (!canStore(await this.ports.usage.current(now), bytes.length, now).allowed) {
      return { ok: false, code: "media_quota" };
    }
    const storageKey = await this.ports.blobs.put(bytes, sniffed.contentType);
    await this.ports.usage.record({ storedBytes: bytes.length, classA: 1, classB: 0 }, now);
    const id = stagedMediaId(this.ports.ids.newId());
    await this.ports.media.save({
      id,
      ownerAccountId: account.id,
      kind: sniffed.kind,
      contentType: sniffed.contentType,
      size: bytes.length,
      storageKey,
      sha256: await this.ports.hasher.sha256Hex(bytes),
      stagedAt: now,
      attachedTo: null,
    });
    await this.ports.audit.done(
      { actor, action: "media.stage", accountId: account.id, postId: null },
      id,
    );
    return { ok: true, mediaId: id, kind: sniffed.kind, size: bytes.length };
  }
}
