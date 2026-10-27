import type { AccountReconciler } from "../ports/account_reconciler";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { PostReader } from "../ports/post_reader";
import { fanOut } from "../run_services/fan_out";
import type { ReconcileTickInputBoundary } from "./input_boundary";
import type { ReconcileTickInputData } from "./input_data";
import type { ReconcileTickOutputBoundary } from "./output_boundary";

/** Cron `*\/10` (plan §3.3 #6): every account with an UNKNOWN part reconciles in its DO. */
export class ReconcileTickInteractor implements ReconcileTickInputBoundary {
  constructor(
    private readonly reader: PostReader,
    private readonly reconciler: AccountReconciler,
    private readonly meter: BudgetMeter,
    private readonly clock: Clock,
    private readonly presenter: ReconcileTickOutputBoundary,
  ) {}

  async execute(input: ReconcileTickInputData): Promise<void> {
    const now = this.clock.now();
    const work = (await this.reader.accountsNeedingWork(now)).filter((item) => item.reconcile);
    const deadline = this.meter.remaining().deadline;
    const run = await fanOut(work, this.meter, this.clock, (account) =>
      this.reconciler.reconcile(account, now, deadline),
    );
    this.presenter.present({
      job: input.actor.job,
      dispatched: run.results.length,
      waiting: run.waiting,
      found: run.results.reduce((sum, summary) => sum + summary.found, 0),
      notFound: run.results.reduce((sum, summary) => sum + summary.notFound, 0),
    });
  }
}
