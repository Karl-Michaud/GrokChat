import { fits, spend, type Budget, type CallCost } from "../../entities/budget/budget";
import type { Instant } from "../../entities/time/instant";
import type { BudgetMeter } from "../../use_cases/ports/budget_meter";

export class MemoryBudgetMeter implements BudgetMeter {
  constructor(private budget: Budget) {}

  fits(cost: CallCost, now: Instant): boolean {
    return fits(this.budget, cost, now);
  }

  spend(cost: Omit<CallCost, "millis">): void {
    this.budget = spend(this.budget, cost);
  }

  remaining(): Budget {
    return this.budget;
  }
}
