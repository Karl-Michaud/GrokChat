import { DASHBOARD_SOURCE, MAX_UPLOAD_BYTES } from "../../entities/content/staged_media";
import { parseMediaLabel } from "../../entities/media/media_label";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { MediaIntake } from "../media/media_intake";
import type { AccountRepository } from "../ports/account_repository";
import type { StageMediaUploadInputBoundary } from "./input_boundary";
import type { StageMediaUploadInputData } from "./input_data";
import type { StageMediaUploadOutputBoundary } from "./output_boundary";
import type { StageMediaUploadOutputData } from "./output_data";

/**
 * The dashboard's Media page uploads a file for one account (plan §3.3 #3, GROKCHAT-18): human
 * only, with a label, the kind from the magic bytes and the same limits as `stage_media_from_url`,
 * stored like staged media (R2 and its D1 row, under the quota guard and the same cleanup).
 */
export class StageMediaUploadInteractor implements StageMediaUploadInputBoundary {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly intake: MediaIntake,
    private readonly guard: AccessGuard,
    private readonly presenter: StageMediaUploadOutputBoundary,
  ) {}

  async execute(input: StageMediaUploadInputData): Promise<void> {
    this.presenter.present(await this.stage(input));
  }

  private async stage(input: StageMediaUploadInputData): Promise<StageMediaUploadOutputData> {
    const account = await this.accounts.get(input.accountId);
    if (account === null) {
      return refusal("not_found");
    }
    const action = {
      actor: input.actor,
      action: "media.upload",
      accountId: account.id,
      postId: null,
    };
    if (!(await this.guard.humanOnly(action))) {
      return refusal("human_only");
    }
    const label = parseMediaLabel(input.label);
    if (!label.ok) {
      return refusal("invalid_label");
    }
    if (input.bytes.length > MAX_UPLOAD_BYTES) {
      return refusal("too_large");
    }
    const origin = { label: label.label, source: DASHBOARD_SOURCE };
    const stored = await this.intake.store(input.actor, account, input.bytes, origin);
    return stored.ok ? stored : refusal(stored.code);
  }
}
