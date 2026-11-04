import type { AccountId, PostId } from "../../entities/identity/ids";
import { compareDue, isDue } from "../../entities/posts/due";
import { missed } from "../../entities/posts/missed";
import type { Post } from "../../entities/posts/post";
import type { Millis } from "../../entities/time/instant";
import type { AccountRepository } from "../ports/account_repository";
import type { PublishSummary } from "../ports/account_publisher";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { LockResult, Locks } from "../ports/locks";
import type { PostReader } from "../ports/post_reader";
import type { AccountRecovery } from "./account_recovery";
import type { GuardedTransition } from "./guarded_transition";
import type { PartSender } from "./part_sender";

export interface PublishPostPorts {
  readonly reader: PostReader;
  readonly accounts: AccountRepository;
  readonly locks: Locks;
  readonly clock: Clock;
  readonly recovery: AccountRecovery;
  readonly steps: GuardedTransition;
  readonly sender: PartSender;
}

/** One post's run: what it sent, and whether the run must stop (budget yield or app 429). */
interface PostRun {
  readonly sent: number;
  readonly touched: readonly PostId[];
  readonly yielded: boolean;
  readonly appRateLimited: boolean;
}

const NOT_RUN: PublishSummary = { ran: false, sent: 0, touched: [], appRateLimited: false };
const NOTHING: PublishSummary = { ran: true, sent: 0, touched: [], appRateLimited: false };
const SKIPPED: PostRun = { sent: 0, touched: [], yielded: false, appRateLimited: false };

function unwrap(result: LockResult<PublishSummary>): PublishSummary {
  return result.acquired ? result.value : NOT_RUN;
}

/**
 * The run service executed inside the account's Durable Object under `Locks.publish` (plan §3.3
 * #4): recovery first, then each due post, oldest due first, part by part, until the budget yields
 * or X rate-limits the whole app.
 */
export class PublishPost {
  constructor(private readonly ports: PublishPostPorts) {}

  async publishDue(account: AccountId, meter: BudgetMeter): Promise<PublishSummary> {
    return unwrap(await this.ports.locks.publish.run(() => this.due(account, meter), null));
  }

  /** The lock wait counts against the deadline (m1/m5): on a timeout nothing changes. */
  async publishNow(account: AccountId, post: PostId, meter: BudgetMeter): Promise<PublishSummary> {
    const deadline = meter.remaining().deadline;
    return unwrap(
      await this.ports.locks.publish.run(() => this.one(account, post, meter), deadline),
    );
  }

  private async due(account: AccountId, meter: BudgetMeter): Promise<PublishSummary> {
    const now = this.ports.clock.now();
    await this.ports.recovery.recover(account, now);
    const owner = await this.ports.accounts.get(account);
    if (owner === null) {
      return NOTHING;
    }
    const due = await this.ports.reader.list({ accountIds: [account], dueBy: now });
    return this.runAll([...due].sort(compareDue), owner.policy.grace, meter);
  }

  private async one(account: AccountId, id: PostId, meter: BudgetMeter): Promise<PublishSummary> {
    const now = this.ports.clock.now();
    await this.ports.recovery.recover(account, now);
    const owner = await this.ports.accounts.get(account);
    const post = await this.ports.reader.get(id);
    if (owner === null || post?.accountId !== account || !isDue(post, now)) {
      return NOTHING;
    }
    return this.runAll([post], owner.policy.grace, meter);
  }

  private async runAll(
    posts: readonly Post[],
    grace: Millis,
    meter: BudgetMeter,
  ): Promise<PublishSummary> {
    let summary = NOTHING;
    for (const post of posts) {
      const run = await this.runPost(post, grace, meter);
      summary = {
        ran: true,
        sent: summary.sent + run.sent,
        touched: [...summary.touched, ...run.touched],
        appRateLimited: run.appRateLimited,
      };
      if (run.appRateLimited || run.yielded) {
        break;
      }
    }
    return summary;
  }

  /** A post past its grace is marked MISSED; any other due post is started and sent. */
  private async runPost(post: Post, grace: Millis, meter: BudgetMeter): Promise<PostRun> {
    const now = this.ports.clock.now();
    if (missed(post, now, grace)) {
      await this.ports.steps.apply(post, { kind: "miss", now, grace });
      return { ...SKIPPED, touched: [post.id] };
    }
    const started = await this.ports.steps.apply(post, { kind: "start", now, grace });
    return started.kind === "ok" ? this.sendParts(started.post, meter) : SKIPPED;
  }

  private async sendParts(post: Post, meter: BudgetMeter): Promise<PostRun> {
    let current = post;
    let sent = 0;
    for (;;) {
      const step = await this.ports.sender.sendNext(current, meter);
      sent += step.sent ? 1 : 0;
      if (step.stop !== "continue" || step.post.lifecycle !== "PUBLISHING") {
        return {
          sent,
          touched: [post.id],
          yielded: step.stop === "yielded",
          appRateLimited: step.appRateLimited,
        };
      }
      current = step.post;
    }
  }
}
