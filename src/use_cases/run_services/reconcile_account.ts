import type { Account } from "../../entities/accounts/account";
import { RECONCILE_CHECK_COST } from "../../entities/budget/budget";
import type { AccountId } from "../../entities/identity/ids";
import type { Post } from "../../entities/posts/post";
import type { PostEvent } from "../../entities/posts/post_event";
import { stateAt } from "../../entities/posts/post_parts";
import { normalisePostText } from "../../entities/text/post_text";
import { MINUTE, type Instant } from "../../entities/time/instant";
import type { AccountRepository } from "../ports/account_repository";
import type { ReconcileSummary } from "../ports/account_reconciler";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { PostReader } from "../ports/post_reader";
import type { SingleFlight } from "../ports/single_flight";
import type { XOwnTimelineReader, XPostSummary } from "../ports/x_own_timeline_reader";
import type { GuardedTransition } from "./guarded_transition";
import type { TokenStep } from "./token_step";
import type { XCallRecorder } from "./x_call_recorder";

/** Reconcile looks back from a minute before the attempt, at the five newest posts (plan §3.3 #6). */
export const LOOKBACK = MINUTE;
export const TIMELINE_PAGE = 5;

export interface ReconcileAccountPorts {
  readonly reader: PostReader;
  readonly accounts: AccountRepository;
  readonly timeline: XOwnTimelineReader;
  readonly tokenStep: TokenStep;
  readonly recorder: XCallRecorder;
  readonly steps: GuardedTransition;
  readonly flights: SingleFlight;
  readonly clock: Clock;
}

const SKIPPED: ReconcileSummary = { ran: false, found: 0, notFound: 0 };

/**
 * Inside the account's Durable Object, single-flight (m2): each UNKNOWN part is looked for on the
 * account's own timeline by normalised text, and by the reply target for a thread's later part,
 * after the token step (N1), so a refresh that does not fit the deadline yields before any read.
 */
export class ReconcileAccount {
  constructor(private readonly ports: ReconcileAccountPorts) {}

  async reconcile(account: AccountId, meter: BudgetMeter): Promise<ReconcileSummary> {
    const flight = await this.ports.flights.tryRun(`reconcile:${account}`, () =>
      this.run(account, meter),
    );
    return flight.ran ? flight.value : SKIPPED;
  }

  private async run(id: AccountId, meter: BudgetMeter): Promise<ReconcileSummary> {
    const account = await this.ports.accounts.get(id);
    if (account === null) {
      return { ran: true, found: 0, notFound: 0 };
    }
    const posts = await this.ports.reader.list({ accountIds: [id], partStates: ["UNKNOWN"] });
    const targets = posts.flatMap(unknownParts);
    let summary: ReconcileSummary = { ran: true, found: 0, notFound: 0 };
    if (targets.length === 0 || !(await this.ports.tokenStep.ready(id, meter))) {
      return summary;
    }
    for (const target of targets) {
      if (!meter.fits(RECONCILE_CHECK_COST, this.ports.clock.now())) {
        break;
      }
      const event = await this.check(account, target);
      if (event !== null && (await this.ports.steps.apply(target.post, event)).kind === "ok") {
        const found = event.kind === "reconcileFound" ? 1 : 0;
        summary = {
          ...summary,
          found: summary.found + found,
          notFound: summary.notFound + 1 - found,
        };
      }
    }
    return summary;
  }

  /** The reconcile event for one UNKNOWN part, or null when the timeline could not be read. */
  private async check(account: Account, target: UnknownPart): Promise<PostEvent | null> {
    const since = target.attemptAt - LOOKBACK;
    const result = await this.ports.timeline.recent(account.id, since, TIMELINE_PAGE);
    const now = this.ports.clock.now();
    await this.ports.recorder.record({
      account,
      operation: { kind: "read", resources: result.ok ? result.value.length : 0 },
      billed: true,
      outcome: result.ok ? `read ${String(result.value.length)}` : `failed: ${result.failure.kind}`,
      postId: target.post.id,
      at: now,
    });
    if (!result.ok) {
      return null;
    }
    const match = result.value.find((summary) => matches(target, summary));
    const part = target.index;
    return match === undefined
      ? { kind: "reconcileNotFound", part }
      : { kind: "reconcileFound", part, xPostId: match.id, now };
  }
}

interface UnknownPart {
  readonly post: Post;
  readonly index: number;
  readonly text: string;
  readonly attemptAt: Instant;
}

function unknownParts(post: Post): readonly UnknownPart[] {
  return post.parts.flatMap((part, index) =>
    part.state.kind === "UNKNOWN"
      ? [{ post, index, text: part.text, attemptAt: part.state.attemptAt }]
      : [],
  );
}

/** Same normalised text, and a reply to the previous part (a first part replies to nothing). */
function matches(target: UnknownPart, summary: XPostSummary): boolean {
  const previous = stateAt(target.post, target.index - 1);
  const replyTarget = previous?.kind === "SENT" ? previous.xPostId : null;
  const sameText = normalisePostText(summary.text) === normalisePostText(target.text);
  return sameText && summary.inReplyTo === replyTarget;
}
