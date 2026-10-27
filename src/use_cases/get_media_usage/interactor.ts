import { R2_FREE_ALLOWANCE, R2_GUARDS } from "../../entities/media/r2_quota";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { Clock } from "../ports/clock";
import type { MediaUsageRepository } from "../ports/media_usage_repository";
import type { GetMediaUsageInputBoundary } from "./input_boundary";
import type { GetMediaUsageInputData } from "./input_data";
import type { GetMediaUsageOutputBoundary } from "./output_boundary";

export class GetMediaUsageInteractor implements GetMediaUsageInputBoundary {
  constructor(
    private readonly usage: MediaUsageRepository,
    private readonly guard: AccessGuard,
    private readonly clock: Clock,
    private readonly presenter: GetMediaUsageOutputBoundary,
  ) {}

  async execute(input: GetMediaUsageInputData): Promise<void> {
    const action = { actor: input.actor, action: "media.usage", accountId: null, postId: null };
    if (!(await this.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    this.presenter.present({
      ok: true,
      usage: await this.usage.current(this.clock.now()),
      guards: R2_GUARDS,
      allowance: R2_FREE_ALLOWANCE,
    });
  }
}
