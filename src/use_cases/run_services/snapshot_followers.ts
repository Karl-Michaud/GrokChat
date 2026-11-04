import type { Account } from "../../entities/accounts/account";
import { FOLLOWER_READ_COST } from "../../entities/budget/budget";
import type { AccountId } from "../../entities/identity/ids";
import { utcDay, type UserPublicMetrics } from "../../entities/metrics/follower_snapshot";
import type { XFailure } from "../../entities/x/x_failure";
import type { AccountRepository } from "../ports/account_repository";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { FollowerDays } from "../ports/follower_days";
import type { SingleFlight } from "../ports/single_flight";
import type { XUserMetricsReader } from "../ports/x_user_metrics_reader";
import type { TokenStep } from "./token_step";
import type { XCallRecorder } from "./x_call_recorder";

export interface SnapshotFollowersPorts {
  readonly accounts: AccountRepository;
  readonly days: FollowerDays;
  readonly x: XUserMetricsReader;
  readonly tokenStep: TokenStep;
  readonly recorder: XCallRecorder;
  readonly flights: SingleFlight;
  readonly clock: Clock;
}

/** Only an account with tokens is read: a lost or revoked one is skipped until reconnected. */
const CONNECTED: readonly Account["status"][] = ["ACTIVE", "PAUSED"];

/** Failures from before the request left: X billed nothing, so the day is given back. */
const NEVER_SENT: readonly XFailure["kind"][] = ["not_sent", "no_token"];

/**
 * The daily follower snapshot (GROKCHAT-15), inside the account's Durable Object, single-flight:
 * at most one billed User read per account per UTC day. The day is claimed in D1 before X is
 * called, so a reset, a retry or a second tick can never read it twice; a read that may have
 * reached X keeps the claim even when it failed, and only one that never left gives it back.
 */
export class SnapshotFollowers {
  constructor(private readonly ports: SnapshotFollowersPorts) {}

  async snapshot(account: AccountId, meter: BudgetMeter): Promise<boolean> {
    const flight = await this.ports.flights.tryRun(`followers:${account}`, () =>
      this.run(account, meter),
    );
    return flight.ran && flight.value;
  }

  private async run(id: AccountId, meter: BudgetMeter): Promise<boolean> {
    const { accounts, days, tokenStep, clock } = this.ports;
    const account = await accounts.get(id);
    const now = clock.now();
    if (account === null || !CONNECTED.includes(account.status)) {
      return false;
    }
    const day = utcDay(now);
    if (!meter.fits(FOLLOWER_READ_COST, now) || !(await days.claim(id, day, now))) {
      return false;
    }
    if (!(await tokenStep.ready(id, meter))) {
      await days.release(id, day);
      return false;
    }
    return this.read(account, day);
  }

  private async read(account: Account, day: string): Promise<boolean> {
    const { days, x, recorder, clock } = this.ports;
    const result = await x.read(account.id);
    const at = clock.now();
    await recorder.record({
      account,
      operation: { kind: "user_read" },
      billed: result.ok,
      outcome: result.ok ? followersOutcome(result.value) : `failed: ${result.failure.kind}`,
      postId: null,
      at,
    });
    if (result.ok) {
      await days.record({ ...result.value, accountId: account.id, day, takenAt: at });
      return true;
    }
    if (NEVER_SENT.includes(result.failure.kind)) {
      await days.release(account.id, day);
    }
    return false;
  }
}

const followersOutcome = (metrics: UserPublicMetrics): string =>
  `followers ${String(metrics.followers)}`;
