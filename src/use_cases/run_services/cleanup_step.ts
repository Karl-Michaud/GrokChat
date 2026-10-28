import type { BudgetMeter } from "../ports/budget_meter";

/** One cleanup the metrics tick runs inside its budget; answers how many items it deleted. */
export interface CleanupStep {
  run(meter: BudgetMeter): Promise<number>;
}

/** The cleanups in order, each with what the meter still has (GROKCHAT-20: media, then uploads). */
export class CleanupSteps implements CleanupStep {
  constructor(private readonly steps: readonly CleanupStep[]) {}

  async run(meter: BudgetMeter): Promise<number> {
    let deleted = 0;
    for (const step of this.steps) {
      deleted += await step.run(meter);
    }
    return deleted;
  }
}
