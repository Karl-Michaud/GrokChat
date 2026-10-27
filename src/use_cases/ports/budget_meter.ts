import type { Budget, CallCost } from "../../entities/budget/budget";
import type { Instant } from "../../entities/time/instant";

/**
 * The invocation's remaining budget. Port decorators spend from it as calls happen; use cases ask
 * whether a step's worst case still fits before starting it (plan §3.2, A4, U16).
 */
export interface BudgetMeter {
  fits(cost: CallCost, now: Instant): boolean;
  spend(cost: Omit<CallCost, "millis">): void;
  remaining(): Budget;
}
