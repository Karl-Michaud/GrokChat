import type { Account } from "../../entities/accounts/account";
import { createMicros } from "../../entities/costs/estimate_cost";
import type { StagedMedia } from "../../entities/content/staged_media";
import { postId, type BotId } from "../../entities/identity/ids";
import { derivedStatus } from "../../entities/posts/derived_status";
import { newPost, requestHash } from "../../entities/posts/new_post";
import type { Post } from "../../entities/posts/post";
import { SECOND } from "../../entities/time/instant";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import type { MediaAttachments } from "../authoring/media_attachments";
import type { PartsValidator } from "../authoring/parts_validator";
import type { AccountPublisher } from "../ports/account_publisher";
import type { AccountRepository } from "../ports/account_repository";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id_generator";
import type { PersonalityRepository } from "../ports/personality_repository";
import type { PostReader } from "../ports/post_reader";
import type { PostWriter } from "../ports/post_writer";
import type { CreatePostInputBoundary } from "./input_boundary";
import type { CreatePostInputData } from "./input_data";
import type { CreatePostOutputBoundary } from "./output_boundary";
import type { CreatePostOutputData, CreatePostRefusalCode } from "./output_data";

/** The inline publish budget: well inside xAI's 60 s tool timeout (plan §3.3 #1). */
export const PUBLISH_NOW_BUDGET = 10 * SECOND;

export interface CreatePostPorts {
  readonly accounts: AccountRepository;
  readonly personalities: PersonalityRepository;
  readonly reader: PostReader;
  readonly writer: PostWriter;
  readonly attachments: MediaAttachments;
  readonly validator: PartsValidator;
  readonly publisher: AccountPublisher;
  readonly guard: AccessGuard;
  readonly audit: ActionAudit;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

const refuse = (code: CreatePostRefusalCode, part: number | null = null): CreatePostOutputData => ({
  ok: false,
  code,
  part,
});

function estimate(post: Post): number {
  return post.parts.reduce((sum, part) => sum + createMicros(part.text), 0);
}

export class CreatePostInteractor implements CreatePostInputBoundary {
  constructor(
    private readonly ports: CreatePostPorts,
    private readonly presenter: CreatePostOutputBoundary,
  ) {}

  async execute(input: CreatePostInputData): Promise<void> {
    this.presenter.present(await this.create(input));
  }

  private async create(input: CreatePostInputData): Promise<CreatePostOutputData> {
    const account = await this.ports.accounts.get(input.accountId);
    if (account === null) {
      return refuse("not_found");
    }
    const action = {
      actor: input.actor,
      action: "post.create",
      accountId: account.id,
      postId: null,
    };
    if (!(await this.ports.guard.inScope(action))) {
      return refuse("scope");
    }
    const hash = requestHash(account.id, input.parts, input.publishAt);
    if (input.actor.kind !== "bot") {
      return this.build(input, account, null, hash);
    }
    const bot = input.actor.scope.botId;
    if (input.idempotencyKey === null) {
      return refuse("idempotency_key_required");
    }
    const earlier = await this.ports.reader.findByIdempotency(bot, input.idempotencyKey);
    return earlier === null ? this.build(input, account, bot, hash) : this.duplicate(earlier, hash);
  }

  private duplicate(existing: Post, hash: string): CreatePostOutputData {
    if (existing.requestHash !== hash) {
      return refuse("idempotency_mismatch");
    }
    const status = derivedStatus(existing);
    return {
      ok: true,
      postId: existing.id,
      status,
      estimatedCostMicros: estimate(existing),
      duplicate: true,
    };
  }

  private async build(
    input: CreatePostInputData,
    account: Account,
    bot: BotId | null,
    hash: string,
  ): Promise<CreatePostOutputData> {
    const id = postId(this.ports.ids.newId());
    const checked = await this.ports.validator.check(account, input.parts, null);
    if (!checked.ok) {
      return refuse(checked.code, checked.part);
    }
    const now = this.ports.clock.now();
    if (input.publishAt !== null && input.publishAt < now - account.policy.grace) {
      return refuse("publish_at_past");
    }
    const personality = await this.ports.personalities.get(account.personalityId);
    if (personality === null) {
      return refuse("personality_not_found");
    }
    const post = newPost(
      {
        id,
        accountId: account.id,
        parts: checked.parts,
        publishAt: input.publishAt ?? now,
        resumeAt: null,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        createdBy: input.actor,
        provenance: {
          botId: bot,
          personalityVersion: personality.version,
          policySnapshot: account.policy,
        },
      },
      account.policy.mode,
    );
    return this.store(account, post, checked.media);
  }

  private async store(
    account: Account,
    post: Post,
    media: readonly StagedMedia[],
  ): Promise<CreatePostOutputData> {
    const added = await this.ports.writer.add(post);
    if (added.kind === "duplicate") {
      return this.duplicate(added.existing, post.requestHash);
    }
    await this.ports.attachments.replace(post.id, media);
    await this.ports.audit.done({
      actor: post.createdBy,
      action: "post.create",
      accountId: account.id,
      postId: post.id,
    });
    return this.publishIfDue(account, post);
  }

  private async publishIfDue(account: Account, post: Post): Promise<CreatePostOutputData> {
    const now = this.ports.clock.now();
    if (post.lifecycle === "SCHEDULED" && post.publishAt <= now) {
      await this.ports.publisher.publishNow(account.id, post.id, now + PUBLISH_NOW_BUDGET);
    }
    const latest = (await this.ports.reader.get(post.id)) ?? post;
    const status = derivedStatus(latest);
    return {
      ok: true,
      postId: post.id,
      status,
      estimatedCostMicros: estimate(post),
      duplicate: false,
    };
  }
}
