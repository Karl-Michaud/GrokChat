import type { Clock } from "../../use_cases/ports/clock";
import { runTick, type TickJob, type TickLog } from "./tick_runner";

/** The three Cron Triggers in wrangler.jsonc (plan §3.3 #5, #6, #8; §3.6). */
export const CRONS = {
  publish: "* * * * *",
  reconcile: "*/10 * * * *",
  metrics: "*/15 * * * *",
} as const;

export type CronName = keyof typeof CRONS;

export type CronJobs = Readonly<Record<CronName, TickJob>>;

const NAMES = Object.keys(CRONS) as readonly CronName[];

/**
 * The Cron Trigger entry (plan §3.5): `scheduled()` runs the job its `controller.cron` names. A
 * schedule that is not one of the three fails loudly rather than run the wrong job.
 */
export function dispatchScheduled(
  cron: string,
  jobs: CronJobs,
  clock: Clock,
  log?: TickLog,
): Promise<void> {
  const name = NAMES.find((candidate) => CRONS[candidate] === cron);
  if (name === undefined) {
    return Promise.reject(new Error(`no tick is scheduled as "${cron}"`));
  }
  return runTick(jobs[name], clock, log);
}
