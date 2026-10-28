import type { Account } from "../../entities/accounts/account";
import { BOT_UPLOAD_SOURCE } from "../../entities/content/staged_media";
import type { Actor } from "../../entities/identity/actor";
import type { StagedMediaId } from "../../entities/identity/ids";
import { canStore } from "../../entities/media/r2_quota";
import {
  assemblyLeaseUntil,
  joinParts,
  missingParts,
  uploadExpired,
  uploadExpiresAt,
} from "../../entities/media/upload_parts";
import { refusal } from "../access/refusal";
import type { Clock } from "../ports/clock";
import type { ContentHasher } from "../ports/content_hasher";
import type { IdGenerator } from "../ports/id_generator";
import type { MediaRepository } from "../ports/media_repository";
import type { MediaUsageRepository } from "../ports/media_usage_repository";
import type { PendingUpload, PendingUploads, StoredPart } from "../ports/pending_uploads";
import type { HashMismatch, UploadMediaOutputData } from "../upload_media/output_data";
import type { MediaIntake } from "./media_intake";

/** One part whose bytes already passed their own hash (`upload_media`, GROKCHAT-20). */
export interface CheckedPart {
  readonly uploadId: string | null;
  readonly index: number;
  readonly count: number;
  readonly fileSha256: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly label: string | null;
}

export interface PartUploadPorts {
  readonly uploads: PendingUploads;
  readonly media: MediaRepository;
  readonly usage: MediaUsageRepository;
  readonly hasher: ContentHasher;
  readonly intake: MediaIntake;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

type Resolved =
  | { readonly upload: PendingUpload; readonly stored: readonly StoredPart[] }
  | Exclude<UploadMediaOutputData, { readonly ok: true }>;

export function fileHashMismatch(
  expected: string,
  actual: string,
): HashMismatch<"file_hash_mismatch"> {
  return { ...refusal("file_hash_mismatch"), part: null, expected, actual };
}

const partOf = (part: CheckedPart): StoredPart => ({
  index: part.index,
  sha256: part.sha256,
  size: part.bytes.length,
});

const sizeOf = (parts: readonly StoredPart[]): number =>
  parts.reduce((sum, part) => sum + part.size, 0);

/**
 * The file as it comes in through `upload_media`: one checked file, or parts kept in the pending
 * uploads until every one is in; then the whole file's hash, then `MediaIntake` (magic bytes, X's
 * limits, the R2 quota guard) with the bot-upload source. The parts' bytes count in the R2 usage
 * while they are kept, and every write, list and read is counted as an R2 operation.
 */
export class PartUpload {
  constructor(private readonly ports: PartUploadPorts) {}

  /** A file sent whole: its one part's hash must be the file's. */
  async single(actor: Actor, account: Account, part: CheckedPart): Promise<UploadMediaOutputData> {
    if (part.sha256 !== part.fileSha256) {
      return fileHashMismatch(part.fileSha256, part.sha256);
    }
    return this.store(actor, account, part.bytes, part.label, null);
  }

  async accept(actor: Actor, account: Account, part: CheckedPart): Promise<UploadMediaOutputData> {
    if (part.uploadId === null) {
      return this.open(account, part);
    }
    const resolved = await this.resolve(account, part.uploadId, part);
    if (!("upload" in resolved)) {
      return resolved;
    }
    const { upload, stored } = resolved;
    if (upload.mediaId !== null) {
      return this.finished(upload.id, upload.mediaId);
    }
    const kept = await this.keep(upload, stored, part);
    if (kept !== null) {
      return kept;
    }
    return this.progress(actor, account, upload, [...stored, partOf(part)]);
  }

  /**
   * Lists the parts again after this one was written, so of parts sent at the same time the
   * last one written sees them all; then only the call that claims the upload assembles it.
   */
  private async progress(
    actor: Actor,
    account: Account,
    upload: PendingUpload,
    known: readonly StoredPart[],
  ): Promise<UploadMediaOutputData> {
    const now = this.ports.clock.now();
    const fresh = await this.ports.uploads.parts(upload.id);
    await this.ports.usage.record({ storedBytes: 0, classA: 1, classB: 0 }, now);
    const listed = new Set(fresh.map((item) => item.index));
    if (known.some((item) => !listed.has(item.index))) {
      // Parts seen before are gone: another call staged the file (or discarded the upload).
      return this.settled(upload.id);
    }
    const missing = missingParts(upload.partCount, listed);
    if (missing.length > 0) {
      return { ok: true, complete: false, uploadId: upload.id, missing };
    }
    const claimed = await this.ports.uploads.claim(upload.id, now, assemblyLeaseUntil(now));
    await this.ports.usage.record({ storedBytes: 0, classA: 1, classB: 1 }, now);
    return claimed ? this.assemble(actor, account, upload, fresh) : this.settled(upload.id);
  }

  /** Another call holds or finished the upload: its media once staged, else still in progress. */
  private async settled(uploadId: string): Promise<UploadMediaOutputData> {
    const upload = await this.ports.uploads.get(uploadId);
    await this.ports.usage.record({ storedBytes: 0, classA: 0, classB: 1 }, this.ports.clock.now());
    if (upload === null) {
      return refusal("upload_not_found");
    }
    return upload.mediaId === null
      ? { ok: true, complete: false, uploadId, missing: [] }
      : this.finished(uploadId, upload.mediaId);
  }

  /** The first part sent of several opens the upload (it can never be the last one in). */
  private async open(account: Account, part: CheckedPart): Promise<UploadMediaOutputData> {
    const now = this.ports.clock.now();
    if (!canStore(await this.ports.usage.current(now), part.bytes.length, now).allowed) {
      return refusal("media_quota");
    }
    const upload: PendingUpload = {
      id: this.ports.ids.newId(),
      accountId: account.id,
      fileSha256: part.fileSha256,
      partCount: part.count,
      label: part.label,
      expiresAt: uploadExpiresAt(now),
      mediaId: null,
    };
    await this.ports.uploads.open(upload);
    await this.ports.uploads.putPart(upload, partOf(part), part.bytes);
    const usage = { storedBytes: part.bytes.length, classA: 2, classB: 0 };
    await this.ports.usage.record(usage, now);
    const missing = missingParts(upload.partCount, [part.index]);
    return { ok: true, complete: false, uploadId: upload.id, missing };
  }

  /** The upload a later part names, if it is this account's, live and the same file. */
  private async resolve(account: Account, uploadId: string, part: CheckedPart): Promise<Resolved> {
    const now = this.ports.clock.now();
    const upload = await this.ports.uploads.get(uploadId);
    if (upload?.accountId !== account.id) {
      return refusal("upload_not_found");
    }
    const stored = await this.ports.uploads.parts(upload.id);
    await this.ports.usage.record({ storedBytes: 0, classA: 1, classB: 1 }, now);
    if (uploadExpired(upload.expiresAt, now)) {
      await this.release(upload.id, stored);
      return refusal("upload_expired");
    }
    if (upload.fileSha256 !== part.fileSha256 || upload.partCount !== part.count) {
      return refusal("upload_mismatch");
    }
    return { upload, stored };
  }

  /** Stores the part (a resend of the same bytes writes nothing), under the R2 quota guard. */
  private async keep(
    upload: PendingUpload,
    stored: readonly StoredPart[],
    part: CheckedPart,
  ): Promise<UploadMediaOutputData | null> {
    const previous = stored.find((item) => item.index === part.index);
    if (previous?.sha256 === part.sha256) {
      return null;
    }
    const now = this.ports.clock.now();
    const added = part.bytes.length - (previous?.size ?? 0);
    if (!canStore(await this.ports.usage.current(now), added, now).allowed) {
      return refusal("media_quota");
    }
    await this.ports.uploads.putPart(upload, partOf(part), part.bytes);
    await this.ports.usage.record({ storedBytes: added, classA: 1, classB: 0 }, now);
    return null;
  }

  /** Every part is in: read them in order, check the whole file's hash, then stage it. */
  private async assemble(
    actor: Actor,
    account: Account,
    upload: PendingUpload,
    received: readonly StoredPart[],
  ): Promise<UploadMediaOutputData> {
    const now = this.ports.clock.now();
    const bytes: Uint8Array[] = [];
    for (let index = 0; index < upload.partCount; index += 1) {
      const part = await this.ports.uploads.readPart(upload.id, index);
      if (part === null) {
        await this.ports.uploads.unclaim(upload.id);
        await this.ports.usage.record({ storedBytes: 0, classA: 1, classB: 1 }, now);
        return { ok: true, complete: false, uploadId: upload.id, missing: [index] };
      }
      bytes.push(part);
    }
    await this.ports.usage.record({ storedBytes: 0, classA: 0, classB: bytes.length }, now);
    const file = joinParts(bytes);
    const actual = await this.ports.hasher.sha256Hex(file);
    if (actual !== upload.fileSha256) {
      await this.release(upload.id, received);
      return fileHashMismatch(upload.fileSha256, actual);
    }
    const result = await this.store(actor, account, file, upload.label, upload.id);
    if (result.ok) {
      await this.ports.uploads.finish(upload.id, result.mediaId);
      await this.ports.usage.record({ storedBytes: -sizeOf(received), classA: 1, classB: 0 }, now);
    } else {
      await this.release(upload.id, received);
    }
    return result;
  }

  private async store(
    actor: Actor,
    account: Account,
    file: Uint8Array,
    label: string | null,
    uploadId: string | null,
  ) {
    const origin = { label, source: BOT_UPLOAD_SOURCE };
    const stored = await this.ports.intake.store(actor, account, file, origin);
    return stored.ok ? { ...stored, complete: true as const, uploadId } : refusal(stored.code);
  }

  /** A part resent after the file was staged answers with the same media. */
  private async finished(uploadId: string, mediaId: StagedMediaId): Promise<UploadMediaOutputData> {
    const media = await this.ports.media.get(mediaId);
    if (media === null) {
      return refusal("upload_not_found");
    }
    return { ok: true, complete: true, mediaId, kind: media.kind, size: media.size, uploadId };
  }

  private async release(id: string, parts: readonly StoredPart[]): Promise<void> {
    await this.ports.uploads.discard(id);
    await this.ports.usage.record(
      { storedBytes: -sizeOf(parts), classA: 1, classB: 0 },
      this.ports.clock.now(),
    );
  }
}
