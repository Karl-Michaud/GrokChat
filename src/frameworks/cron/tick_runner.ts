import { invocationBudget } from "../../entities/budget/budget";
import { MINUTE, type Millis } from "../../entities/time/instant";
import {
  TickController,
  type TickInputBoundary,
} from "../../interface_adapters/cron/tick_controller";
import { TickPresenter } from "../../interface_adapters/cron/tick_presenter";
import { TickViewModel } from "../../interface_adapters/cron/tick_view_model";
import type { BudgetMeter } from "../../use_cases/ports/budget_meter";
import type { Clock } from "../../use_cases/ports/clock";
import { MemoryBudgetMeter } from "../memory/memory_budget";

/**
 * How long each tick's Worker invocation dispatches for, from its start; every account's DO call
 * gets the same deadline. Each is longer than a token refresh's un-aborted minute, so a refresh
 * can start in a tick (`publishNow`'s 10 s never starts one, R18), and well inside the 15 minutes
 * a cron invocation may run. The publish tick's two minutes let at most one tick overlap the next;
 * the publish lock keeps an account's two calls apart.
 */
export const TICK_WINDOWS = {
  publish: 2 * MINUTE,
  reconcile: 5 * MINUTE,
  metrics: 10 * MINUTE,
} as const satisfies Record<string, Millis>;

/** One cron job: its name (the system actor) and its use case over the tick's meter. */
export interface TickJob {
  readonly job: string;
  readonly window: Millis;
  build(meter: BudgetMeter, presenter: TickPresenter): TickInputBoundary;
}

export type TickLog = (line: string) => void;

const consoleLog: TickLog = (line) => {
  console.log(line);
};

/**
 * Runs one tick in this Worker invocation: a fresh budget until its window ends (U16: the
 * invocation's 1,000 Cloudflare-service calls and 50 external subrequests), the use case through
 * its controller, and the summary logged. A tick that throws rejects `scheduled()`, so Workers
 * records the failed run.
 */
export async function runTick(
  tick: TickJob,
  clock: Clock,
  log: TickLog = consoleLog,
): Promise<void> {
  const meter = new MemoryBudgetMeter(invocationBudget(clock.now() + tick.window));
  const view = new TickViewModel();
  await new TickController(tick.job, tick.build(meter, new TickPresenter(view))).run();
  const shown = view.current();
  if (shown !== null) {
    log(shown.line);
  }
}
