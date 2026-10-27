import type { Account } from "../../entities/accounts/account";
import { METRICS_READ_COST } from "../../entities/budget/budget";
import type { AccountId, XPostId } from "../../entities/identity/ids";
import { metricsDue } from "../../entities/metrics/metrics_due";
import type { Instant } from "../../entities/time/instant";
import type { AccountRepository } from "../ports/account_repository";
import type { MetricsSummary } from "../ports/account_metrics_collector";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { MetricsRepository } from "../ports/metrics_repository";
import type { PostReader } from "../ports/post_reader";
import type { SingleFlight } from "../ports/single_flight";
import type { XMetricsReader } from "../ports/x_metrics_reader";
import type { XCallRecorder } from "./x_call_recorder";

/** X reads at most 100 posts per call (plan §3.3 #8). */
export const METRICS_BATCH = 100;

export interface CollectAccountMetricsPorts {
  readonly reader: PostReader;
  readonly accounts: AccountRepository;
  readonly metrics: MetricsRepository;
  readonly x: XMetricsReader;
  readonly recorder: XCallRecorder;
  readonly flights: SingleFlight;
  readonly clock: Clock;
}

const SKIPPED: MetricsSummary = { ran: false, read: 0 };

/** Inside the account's Durable Object, single-flight (m2): reads the posts whose metrics are due. */
export class CollectAccountMetrics {
  constructor(private readonly ports: CollectAccountMetricsPorts) {}

  async collect(account: AccountId, meter: BudgetMeter): Promise<MetricsSummary> {
    const flight = await this.ports.flights.tryRun(`metrics:${account}`, () =>
      this.run(account, meter),
    );
    return flight.ran ? flight.value : SKIPPED;
  }

  private async run(id: AccountId, meter: BudgetMeter): Promise<MetricsSummary> {
    const account = await this.ports.accounts.get(id);
    if (account === null) {
      return { ran: true, read: 0 };
    }
    const due = await this.duePosts(id, this.ports.clock.now());
    let read = 0;
    for (let start = 0; start < due.length; start += METRICS_BATCH) {
      if (!meter.fits(METRICS_READ_COST, this.ports.clock.now())) {
        break;
      }
      read += await this.readBatch(account, due.slice(start, start + METRICS_BATCH));
    }
    return { ran: true, read };
  }

  private async duePosts(account: AccountId, now: Instant): Promise<readonly XPostId[]> {
    const posts = await this.ports.reader.list({ accountIds: [account], partStates: ["SENT"] });
    const sent = posts.flatMap((post) =>
      post.parts.flatMap((part) => (part.state.kind === "SENT" ? [part.state] : [])),
    );
    const latest = await this.ports.metrics.latest(sent.map((state) => state.xPostId));
    const lastTaken = new Map(latest.map((snapshot) => [snapshot.xPostId, snapshot.takenAt]));
    return sent
      .filter((state) => metricsDue(state.at, lastTaken.get(state.xPostId) ?? null, now))
      .map((state) => state.xPostId);
  }

  private async readBatch(account: Account, ids: readonly XPostId[]): Promise<number> {
    const result = await this.ports.x.read(account.id, ids);
    await this.ports.recorder.record({
      account,
      operation: { kind: "read", resources: ids.length },
      billed: result.ok,
      outcome: result.ok ? `read ${String(result.value.length)}` : `failed: ${result.failure.kind}`,
      postId: null,
      at: this.ports.clock.now(),
    });
    if (!result.ok) {
      return 0;
    }
    await this.ports.metrics.addSnapshots(result.value);
    return result.value.length;
  }
}
