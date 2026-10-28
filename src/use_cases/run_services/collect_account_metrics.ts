import type { Account } from "../../entities/accounts/account";
import { METRICS_READ_COST } from "../../entities/budget/budget";
import type { AccountId, XPostId } from "../../entities/identity/ids";
import { metricsDue } from "../../entities/metrics/metrics_due";
import type { Instant } from "../../entities/time/instant";
import type { AccountRepository } from "../ports/account_repository";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { ImportedPostStore } from "../ports/imported_posts";
import type { MetricsRepository } from "../ports/metrics_repository";
import type { PostReader } from "../ports/post_reader";
import type { SingleFlight } from "../ports/single_flight";
import type { XMetricsReader } from "../ports/x_metrics_reader";
import type { TokenStep } from "./token_step";
import type { XCallRecorder } from "./x_call_recorder";

/** X reads at most 100 posts per call (plan §3.3 #8). */
export const METRICS_BATCH = 100;

export interface CollectAccountMetricsPorts {
  readonly reader: PostReader;
  readonly accounts: AccountRepository;
  readonly metrics: MetricsRepository;
  readonly imported: ImportedPostStore;
  readonly x: XMetricsReader;
  readonly tokenStep: TokenStep;
  readonly recorder: XCallRecorder;
  readonly flights: SingleFlight;
  readonly clock: Clock;
}

/** The posts part of a metrics run; the follower snapshot is `SnapshotFollowers`. */
export interface PostMetricsSummary {
  readonly ran: boolean;
  readonly read: number;
}

const SKIPPED: PostMetricsSummary = { ran: false, read: 0 };

/**
 * Inside the account's Durable Object, single-flight (m2): reads the posts whose metrics are due,
 * its own and those imported from the account's timeline (GROKCHAT-19), on the same schedule,
 * after the token step (N1), so a refresh that does not fit the deadline yields before any read.
 */
export class CollectAccountMetrics {
  constructor(private readonly ports: CollectAccountMetricsPorts) {}

  async collect(account: AccountId, meter: BudgetMeter): Promise<PostMetricsSummary> {
    const flight = await this.ports.flights.tryRun(`metrics:${account}`, () =>
      this.run(account, meter),
    );
    return flight.ran ? flight.value : SKIPPED;
  }

  private async run(id: AccountId, meter: BudgetMeter): Promise<PostMetricsSummary> {
    const account = await this.ports.accounts.get(id);
    if (account === null) {
      return { ran: true, read: 0 };
    }
    const due = await this.duePosts(id, this.ports.clock.now());
    if (due.length === 0 || !(await this.ports.tokenStep.ready(id, meter))) {
      return { ran: true, read: 0 };
    }
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
      post.parts.flatMap((part) =>
        part.state.kind === "SENT" ? [{ id: part.state.xPostId, at: part.state.at }] : [],
      ),
    );
    const imported = (await this.ports.imported.list({ accountIds: [account] })).map((post) => ({
      id: post.xPostId,
      at: post.createdAt,
    }));
    const published = [...sent, ...imported];
    const latest = await this.ports.metrics.latest(published.map((post) => post.id));
    const lastTaken = new Map(latest.map((snapshot) => [snapshot.xPostId, snapshot.takenAt]));
    return published
      .filter((post) => metricsDue(post.at, lastTaken.get(post.id) ?? null, now))
      .map((post) => post.id);
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
