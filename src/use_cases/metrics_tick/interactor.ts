import type { AccountId } from "../../entities/identity/ids";
import { utcDay } from "../../entities/metrics/follower_snapshot";
import type { Instant } from "../../entities/time/instant";
import type { AccountMetricsCollector } from "../ports/account_metrics_collector";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { FollowerSchedule } from "../ports/follower_days";
import type { ImportSchedule } from "../ports/imported_posts";
import type { PostReader } from "../ports/post_reader";
import { fanOut } from "../run_services/fan_out";
import type { MediaCleanup } from "../run_services/media_cleanup";
import type { MetricsTickInputBoundary } from "./input_boundary";
import type { MetricsTickInputData } from "./input_data";
import type { MetricsTickOutputBoundary } from "./output_boundary";

export interface MetricsTickPorts {
  readonly reader: PostReader;
  readonly followers: FollowerSchedule;
  readonly imports: ImportSchedule;
  readonly collector: AccountMetricsCollector;
  readonly cleanup: MediaCleanup;
  readonly meter: BudgetMeter;
  readonly clock: Clock;
}

/**
 * Cron `*\/15` (plan §3.3 #8): metrics per account in its DO, then the staged-media cleanup. The
 * accounts visited are those with post metrics due (oldest due first), then those whose follower
 * snapshot for today is not taken yet (GROKCHAT-15), then those whose import of posts made outside
 * GrokChat is due or whose imported posts have metrics due (GROKCHAT-19); the object decides what
 * each one needs.
 */
export class MetricsTickInteractor implements MetricsTickInputBoundary {
  constructor(
    private readonly ports: MetricsTickPorts,
    private readonly presenter: MetricsTickOutputBoundary,
  ) {}

  async execute(input: MetricsTickInputData): Promise<void> {
    const { collector, meter, clock } = this.ports;
    const now = clock.now();
    const work = (await this.accounts(now)).map((accountId) => ({ accountId }));
    const deadline = meter.remaining().deadline;
    const run = await fanOut(work, meter, clock, (account) =>
      collector.collect(account, now, deadline),
    );
    const mediaDeleted = await this.ports.cleanup.run(meter);
    this.presenter.present({
      job: input.actor.job,
      dispatched: run.results.length,
      waiting: run.waiting,
      imported: run.results.reduce((sum, summary) => sum + summary.imported, 0),
      read: run.results.reduce((sum, summary) => sum + summary.read, 0),
      followers: run.results.reduce((sum, summary) => sum + summary.followers, 0),
      mediaDeleted,
    });
  }

  private async accounts(now: Instant): Promise<readonly AccountId[]> {
    const metrics = (await this.ports.reader.accountsNeedingWork(now))
      .filter((item) => item.metrics)
      .map((item) => item.accountId);
    const followers = await this.ports.followers.accountsDue(utcDay(now));
    const imports = await this.ports.imports.accountsDue(now);
    return [...new Set([...metrics, ...followers, ...imports])];
  }
}
