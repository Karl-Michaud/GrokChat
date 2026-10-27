import { DISPATCH_COST, FANOUT_CEILING } from "../../entities/budget/budget";
import type { AccountId } from "../../entities/identity/ids";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { AccountWork } from "../ports/post_reader";

export interface FanOutResult<T> {
  readonly results: readonly T[];
  readonly waiting: number;
}

/**
 * A tick's dispatch to the accounts' Durable Objects (U16): oldest due first, at most 200 per
 * invocation, each costing the tick one Cloudflare-service call; `stopWhen` ends it early.
 */
export async function fanOut<T>(
  work: readonly AccountWork[],
  meter: BudgetMeter,
  clock: Clock,
  dispatch: (account: AccountId) => Promise<T>,
  stopWhen?: (result: T) => boolean,
): Promise<FanOutResult<T>> {
  const results: T[] = [];
  for (const item of work.slice(0, FANOUT_CEILING)) {
    if (!meter.fits(DISPATCH_COST, clock.now())) {
      break;
    }
    const result = await dispatch(item.accountId);
    results.push(result);
    if (stopWhen?.(result) === true) {
      break;
    }
  }
  return { results, waiting: work.length - results.length };
}
