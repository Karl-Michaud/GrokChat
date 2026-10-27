import type { AccountMetricsCollector } from "../ports/account_metrics_collector";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { PostReader } from "../ports/post_reader";
import { fanOut } from "../run_services/fan_out";
import type { MediaCleanup } from "../run_services/media_cleanup";
import type { MetricsTickInputBoundary } from "./input_boundary";
import type { MetricsTickInputData } from "./input_data";
import type { MetricsTickOutputBoundary } from "./output_boundary";

export interface MetricsTickPorts {
  readonly reader: PostReader;
  readonly collector: AccountMetricsCollector;
  readonly cleanup: MediaCleanup;
  readonly meter: BudgetMeter;
  readonly clock: Clock;
}

/** Cron `*\/15` (plan §3.3 #8): metrics per account in its DO, then the staged-media cleanup. */
export class MetricsTickInteractor implements MetricsTickInputBoundary {
  constructor(
    private readonly ports: MetricsTickPorts,
    private readonly presenter: MetricsTickOutputBoundary,
  ) {}

  async execute(input: MetricsTickInputData): Promise<void> {
    const { reader, collector, meter, clock } = this.ports;
    const now = clock.now();
    const work = (await reader.accountsNeedingWork(now)).filter((item) => item.metrics);
    const deadline = meter.remaining().deadline;
    const run = await fanOut(work, meter, clock, (account) =>
      collector.collect(account, now, deadline),
    );
    const mediaDeleted = await this.ports.cleanup.run(now);
    this.presenter.present({
      job: input.actor.job,
      dispatched: run.results.length,
      waiting: run.waiting,
      read: run.results.reduce((sum, summary) => sum + summary.read, 0),
      mediaDeleted,
    });
  }
}
