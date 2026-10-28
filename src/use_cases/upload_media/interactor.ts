import { parseMediaLabel } from "../../entities/media/media_label";
import { checkPart, decodeBase64, MAX_PART_BYTES } from "../../entities/media/upload_parts";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { CheckedPart, PartUpload } from "../media/part_upload";
import type { AccountRepository } from "../ports/account_repository";
import type { ContentHasher } from "../ports/content_hasher";
import type { UploadMediaInputBoundary } from "./input_boundary";
import type { UploadMediaInputData } from "./input_data";
import type { UploadMediaOutputBoundary } from "./output_boundary";
import type { UploadMediaOutputData } from "./output_data";

type Refused = Exclude<UploadMediaOutputData, { readonly ok: true }>;

export interface UploadMediaPorts {
  readonly accounts: AccountRepository;
  readonly guard: AccessGuard;
  readonly hasher: ContentHasher;
  readonly parts: PartUpload;
}

/**
 * A bot uploads a file it made itself (GROKCHAT-20): for one of its person's accounts, in one call
 * or in parts. Each part is checked on arrival (range, strict base64, size, its own SHA-256), so a
 * garbled part is refused at once, naming it; `PartUpload` keeps the parts and stages the file.
 */
export class UploadMediaInteractor implements UploadMediaInputBoundary {
  constructor(
    private readonly ports: UploadMediaPorts,
    private readonly presenter: UploadMediaOutputBoundary,
  ) {}

  async execute(input: UploadMediaInputData): Promise<void> {
    this.presenter.present(await this.upload(input));
  }

  private async upload(input: UploadMediaInputData): Promise<UploadMediaOutputData> {
    const account = await this.ports.accounts.get(input.accountId);
    if (account === null) {
      return refusal("not_found");
    }
    const action = {
      actor: input.actor,
      action: "media.bot_upload",
      accountId: account.id,
      postId: null,
    };
    if (!(await this.ports.guard.inScope(action))) {
      return refusal("scope");
    }
    const part = await this.checked(input);
    if (!("bytes" in part)) {
      return part;
    }
    return input.uploadId === null && input.partCount === 1
      ? this.ports.parts.single(input.actor, account, part)
      : this.ports.parts.accept(input.actor, account, part);
  }

  /** The part as sent: its label, place, base64, size and own hash, each refused at once. */
  private async checked(input: UploadMediaInputData): Promise<CheckedPart | Refused> {
    const label = parseMediaLabel(input.label);
    if (!label.ok) {
      return refusal("invalid_label");
    }
    if (!checkPart(input.partIndex, input.partCount).allowed) {
      return refusal("part_out_of_range");
    }
    const bytes = decodeBase64(input.data);
    if (bytes === null || bytes.length === 0) {
      return refusal("bad_base64");
    }
    if (bytes.length > MAX_PART_BYTES) {
      return refusal("part_too_large");
    }
    const sha256 = await this.ports.hasher.sha256Hex(bytes);
    if (sha256 !== input.partSha256) {
      const mismatch = { part: input.partIndex, expected: input.partSha256, actual: sha256 };
      return { ...refusal("part_hash_mismatch"), ...mismatch };
    }
    return {
      uploadId: input.uploadId,
      index: input.partIndex,
      count: input.partCount,
      fileSha256: input.fileSha256,
      sha256,
      bytes,
      label: label.label,
    };
  }
}
