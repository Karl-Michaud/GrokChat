import type { Account } from "../../entities/accounts/account";
import { partCostForMediaCount, TOKEN_STEP_CALLS } from "../../entities/budget/budget";
import type { AccountId, XMediaId, XPostId } from "../../entities/identity/ids";
import { checkPublishable, nextAllowedAt, STANDING_RETRY } from "../../entities/policy/publishable";
import { eventForOutcome } from "../../entities/posts/outcome_event";
import { currentPartIndex, type Post, type PostPart } from "../../entities/posts/post";
import type { PostEvent } from "../../entities/posts/post_event";
import { stateAt } from "../../entities/posts/post_parts";
import { DEFAULT_RETRY, mapXOutcome, type XOutcome } from "../../entities/x/x_outcome";
import type { AccountRepository } from "../ports/account_repository";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { PostReader } from "../ports/post_reader";
import type { AccessTokenResult, TokenProvider } from "../ports/token_provider";
import type { XPublisher } from "../ports/x_publisher";
import type { GuardedTransition, StepResult } from "./guarded_transition";
import type { MediaStager } from "./media_stager";
import type { XCallRecorder } from "./x_call_recorder";

/** Why a publish run stopped working on a post; `continue` means the next part may follow. */
export type PartStop = "continue" | "deferred" | "yielded" | "done" | "conflict";

export interface PartStep {
  readonly post: Post;
  readonly sent: boolean;
  readonly stop: PartStop;
  readonly appRateLimited: boolean;
}

export interface PartSenderPorts {
  readonly reader: PostReader;
  readonly accounts: AccountRepository;
  readonly tokens: TokenProvider;
  readonly publisher: XPublisher;
  readonly stager: MediaStager;
  readonly recorder: XCallRecorder;
  readonly steps: GuardedTransition;
  readonly clock: Clock;
}

const conflictStep = (post: Post): PartStep => ({
  post,
  sent: false,
  stop: "conflict",
  appRateLimited: false,
});

const toStep = (
  post: Post,
  result: StepResult,
  stop: PartStop,
  extra: Partial<PartStep> = {},
): PartStep =>
  result.kind === "ok"
    ? { post: result.post, sent: false, stop, appRateLimited: false, ...extra }
    : conflictStep(post);

const isAppLimit = (outcome: XOutcome): boolean => outcome.kind === "app_rate_limited";

/**
 * One part of a PUBLISHING post, in the order of plan §3.3 #4 (N1): (1) the token first, (2) the
 * part's worst-case budget, (3) ReservePart: the account and its recent activity, the gate, the
 * media, and SENDING written and awaited, (4) the create, outside any transaction, (5) the outcome
 * committed with its audit and cost in one guarded batch.
 */
export class PartSender {
  constructor(private readonly ports: PartSenderPorts) {}

  async sendNext(post: Post, meter: BudgetMeter): Promise<PartStep> {
    const index = currentPartIndex(post);
    const part = post.parts[index];
    if (part === undefined) {
      return { post, sent: false, stop: "done", appRateLimited: false };
    }
    const now = this.ports.clock.now();
    if (!meter.fits(TOKEN_STEP_CALLS, now)) {
      return this.yieldPost(post);
    }
    const token = await this.ports.tokens.accessToken(post.accountId, meter.remaining().deadline);
    if (token.kind !== "token") {
      return this.tokenRefused(post, index, token);
    }
    if (!meter.fits(partCostForMediaCount(part.media.length), this.ports.clock.now())) {
      return this.yieldPost(post);
    }
    return this.reserveAndSend(post, index, part);
  }

  private async yieldPost(post: Post): Promise<PartStep> {
    const result = await this.ports.steps.apply(post, {
      kind: "yield",
      now: this.ports.clock.now(),
    });
    return toStep(post, result, "yielded");
  }

  private async defer(post: Post, part: number, resumeAt: number): Promise<PartStep> {
    return toStep(
      post,
      await this.ports.steps.apply(post, { kind: "defer", part, resumeAt }),
      "deferred",
    );
  }

  private async tokenRefused(
    post: Post,
    part: number,
    token: Exclude<AccessTokenResult, { kind: "token" }>,
  ): Promise<PartStep> {
    const now = this.ports.clock.now();
    switch (token.kind) {
      case "needs_reconnect":
        await this.markNeedsReconnect(post.accountId);
        return this.defer(post, part, now + STANDING_RETRY);
      case "refresh_does_not_fit":
        return this.yieldPost(post);
      case "unavailable":
        return this.defer(post, part, now + DEFAULT_RETRY);
    }
  }

  private async markNeedsReconnect(id: AccountId): Promise<void> {
    const account = await this.ports.accounts.get(id);
    if (account !== null) {
      await this.ports.accounts.save({ ...account, status: "NEEDS_RECONNECT" });
    }
  }

  private async reserveAndSend(post: Post, index: number, part: PostPart): Promise<PartStep> {
    const now = this.ports.clock.now();
    const account = await this.ports.accounts.get(post.accountId);
    if (account === null) {
      return this.defer(post, index, now + STANDING_RETRY);
    }
    const recent = await this.ports.reader.recentActivity(account.id, now);
    if (!checkPublishable(account, post, now, recent).allowed) {
      return this.defer(post, index, nextAllowedAt(account, post, now, recent));
    }
    const staged = await this.ports.stager.stage(account, post.id, part.media, now);
    if (!staged.ok) {
      return this.failed(post, index, account, staged.outcome, false);
    }
    const reserved = await this.ports.steps.apply(post, { kind: "reserve", part: index, now });
    if (reserved.kind !== "ok") {
      return conflictStep(post);
    }
    return this.create(reserved.post, index, part, account, staged.ids);
  }

  /** A failed X call: the account is marked on a 401/403, then the part goes per §3.1.1. */
  private async failed(
    post: Post,
    index: number,
    account: Account,
    outcome: XOutcome,
    sending: boolean,
  ): Promise<PartStep> {
    if (outcome.kind === "needs_reconnect") {
      await this.ports.accounts.save({ ...account, status: "NEEDS_RECONNECT" });
    }
    const event = eventForOutcome(index, outcome, this.ports.clock.now(), sending);
    const stop: PartStop = event.kind === "rejected" ? "done" : "deferred";
    return toStep(post, await this.ports.steps.apply(post, event), stop, {
      appRateLimited: isAppLimit(outcome),
    });
  }

  private async create(
    post: Post,
    index: number,
    part: PostPart,
    account: Account,
    media: readonly XMediaId[],
  ): Promise<PartStep> {
    const previous = stateAt(post, index - 1);
    const inReplyTo: XPostId | null = previous?.kind === "SENT" ? previous.xPostId : null;
    const result = await this.ports.publisher.create(account.id, part.text, media, inReplyTo);
    const now = this.ports.clock.now();
    if (result.ok) {
      const event: PostEvent = { kind: "sent", part: index, xPostId: result.value, now };
      return this.commit(post, account, part, event, `sent ${result.value}`, true);
    }
    const outcome = mapXOutcome(result.failure, now);
    if (outcome.kind === "needs_reconnect") {
      await this.ports.accounts.save({ ...account, status: "NEEDS_RECONNECT" });
    }
    const event = eventForOutcome(index, outcome, now, true);
    const step = await this.commit(
      post,
      account,
      part,
      event,
      outcome.kind,
      outcome.kind === "unknown",
    );
    return { ...step, appRateLimited: isAppLimit(outcome) };
  }

  private async commit(
    post: Post,
    account: Account,
    part: PostPart,
    event: PostEvent,
    outcome: string,
    billed: boolean,
  ): Promise<PartStep> {
    const now = this.ports.clock.now();
    const operation = { kind: "create", text: part.text } as const;
    const call = { account, operation, billed, outcome, postId: post.id, at: now };
    const { audit, cost } = this.ports.recorder.entries(call);
    const result = await this.ports.steps.commit(post, event, audit, cost);
    const stop: PartStop =
      event.kind === "sent" ? "continue" : event.kind === "retry" ? "deferred" : "done";
    return { ...toStep(post, result, stop), sent: event.kind === "sent" && result.kind === "ok" };
  }
}
