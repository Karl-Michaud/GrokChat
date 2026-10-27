import type { MetricsTickOutputBoundary } from "../../use_cases/metrics_tick/output_boundary";
import type { MetricsTickOutputData } from "../../use_cases/metrics_tick/output_data";
import type { PublishDueTickOutputBoundary } from "../../use_cases/publish_due_tick/output_boundary";
import type { PublishDueTickOutputData } from "../../use_cases/publish_due_tick/output_data";
import type { ReconcileTickOutputBoundary } from "../../use_cases/reconcile_tick/output_boundary";
import type { ReconcileTickOutputData } from "../../use_cases/reconcile_tick/output_data";
import type { TickViewModel } from "./tick_view_model";

type TickOutput = PublishDueTickOutputData | ReconcileTickOutputData | MetricsTickOutputData;

/**
 * Turns a tick's summary into one log line, `tick <job>: name=value …` in the data's own order.
 * A summary holds counts and flags only, so nothing secret can reach the log (R8).
 */
export class TickPresenter
  implements PublishDueTickOutputBoundary, ReconcileTickOutputBoundary, MetricsTickOutputBoundary
{
  constructor(private readonly viewModel: TickViewModel) {}

  present(output: TickOutput): void {
    const { job, ...counts } = output;
    const fields = Object.entries(counts).map(([name, value]) => `${name}=${String(value)}`);
    this.viewModel.update({ line: `tick ${job}: ${fields.join(" ")}` });
  }
}
