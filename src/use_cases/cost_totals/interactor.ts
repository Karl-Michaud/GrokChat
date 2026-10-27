import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { CostLedger } from "../ports/cost_ledger";
import type { CostTotalsInputBoundary } from "./input_boundary";
import type { CostTotalsInputData } from "./input_data";
import type { CostTotalsOutputBoundary } from "./output_boundary";

export class CostTotalsInteractor implements CostTotalsInputBoundary {
  constructor(
    private readonly ledger: CostLedger,
    private readonly guard: AccessGuard,
    private readonly presenter: CostTotalsOutputBoundary,
  ) {}

  async execute(input: CostTotalsInputData): Promise<void> {
    const action = {
      actor: input.actor,
      action: "costs.totals",
      accountId: input.accountId,
      postId: null,
    };
    if (!(await this.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    this.presenter.present({
      ok: true,
      totals: await this.ledger.totals(input.window, input.accountId),
    });
  }
}
