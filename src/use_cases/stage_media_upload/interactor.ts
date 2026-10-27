import { MAX_UPLOAD_BYTES } from "../../entities/content/staged_media";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { MediaIntake } from "../media/media_intake";
import type { AccountRepository } from "../ports/account_repository";
import type { StageMediaUploadInputBoundary } from "./input_boundary";
import type { StageMediaUploadInputData } from "./input_data";
import type { StageMediaUploadOutputBoundary } from "./output_boundary";
import type { StageMediaUploadOutputData } from "./output_data";

/** The dashboard uploads media directly: one request body, at most 4 MB (plan §3.3 #3). */
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
    if (input.bytes.length > MAX_UPLOAD_BYTES) {
      return refusal("too_large");
    }
    const stored = await this.intake.store(input.actor, account, input.bytes);
    return stored.ok ? stored : refusal(stored.code);
  }
}
