import type { AccountPublisher } from "../ports/account_publisher";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { PostReader } from "../ports/post_reader";
import { fanOut } from "../run_services/fan_out";
import type { PublishDueTickInputBoundary } from "./input_boundary";
import type { PublishDueTickInputData } from "./input_data";
import type { PublishDueTickOutputBoundary } from "./output_boundary";

/**
 * Cron `* * * * *` (plan §3.3 #5): one indexed query, then `publishDue` per account (recovery
 * runs inside each call); an app-scope 429 stops the dispatch.
 */
export class PublishDueTickInteractor implements PublishDueTickInputBoundary {
  constructor(
    private readonly reader: PostReader,
    private readonly publisher: AccountPublisher,
    private readonly meter: BudgetMeter,
    private readonly clock: Clock,
    private readonly presenter: PublishDueTickOutputBoundary,
  ) {}

  async execute(input: PublishDueTickInputData): Promise<void> {
    const now = this.clock.now();
    const work = (await this.reader.accountsNeedingWork(now)).filter((item) => item.publish);
    const deadline = this.meter.remaining().deadline;
    const run = await fanOut(
      work,
      this.meter,
      this.clock,
      (account) => this.publisher.publishDue(account, now, deadline),
      (summary) => summary.appRateLimited,
    );
    this.presenter.present({
      job: input.actor.job,
      dispatched: run.results.length,
      waiting: run.waiting,
      stoppedForAppLimit: run.results.some((summary) => summary.appRateLimited),
    });
  }
}
