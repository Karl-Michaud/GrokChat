/**
 * The MCP controllers that change posts and media, one per tool (plan §3.4). Framework-free: the
 * shim passes the entity Actor and the checked arguments as plain values; the controller builds the
 * use case's input data and runs it.
 */
import type { Actor } from "../../entities/identity/actor";
import { accountId, idempotencyKey, postId, stagedMediaId } from "../../entities/identity/ids";
import type { PartInput } from "../../use_cases/authoring/parts_validator";
import type { CancelPostInputBoundary } from "../../use_cases/cancel_post/input_boundary";
import type { CreatePostInputBoundary } from "../../use_cases/create_post/input_boundary";
import type { DeletePostInputBoundary } from "../../use_cases/delete_post/input_boundary";
import type { EditPostInputBoundary } from "../../use_cases/edit_post/input_boundary";
import type { StageMediaFromUrlInputBoundary } from "../../use_cases/stage_media_from_url/input_boundary";
import { instantArg } from "./time_args";
import type {
  CreatePostArgs,
  CreateThreadArgs,
  EditPostArgs,
  PartArgs,
  PostArgs,
  StageMediaArgs,
} from "./tool_args";

function partInput(part: PartArgs): PartInput {
  return { text: part.text, media: (part.media_ids ?? []).map(stagedMediaId) };
}

/** `create_post`: a single post is a thread of one. */
export class CreatePostController {
  constructor(private readonly useCase: CreatePostInputBoundary) {}

  handle(actor: Actor, args: CreatePostArgs): Promise<void> {
    return this.useCase.execute({
      actor,
      accountId: accountId(args.account_id),
      parts: [partInput(args)],
      publishAt: instantArg(args.publish_at),
      idempotencyKey: idempotencyKey(args.idempotency_key),
    });
  }
}

export class CreateThreadController {
  constructor(private readonly useCase: CreatePostInputBoundary) {}

  handle(actor: Actor, args: CreateThreadArgs): Promise<void> {
    return this.useCase.execute({
      actor,
      accountId: accountId(args.account_id),
      parts: args.parts.map(partInput),
      publishAt: instantArg(args.publish_at),
      idempotencyKey: idempotencyKey(args.idempotency_key),
    });
  }
}

export class StageMediaFromUrlController {
  constructor(private readonly useCase: StageMediaFromUrlInputBoundary) {}

  handle(actor: Actor, args: StageMediaArgs): Promise<void> {
    return this.useCase.execute({ actor, accountId: accountId(args.account_id), url: args.url });
  }
}

export class EditPostController {
  constructor(private readonly useCase: EditPostInputBoundary) {}

  handle(actor: Actor, args: EditPostArgs): Promise<void> {
    return this.useCase.execute({
      actor,
      postId: postId(args.post_id),
      parts: args.parts === undefined ? null : args.parts.map(partInput),
      publishAt: instantArg(args.publish_at),
    });
  }
}

export class CancelPostController {
  constructor(private readonly useCase: CancelPostInputBoundary) {}

  handle(actor: Actor, args: PostArgs): Promise<void> {
    return this.useCase.execute({ actor, postId: postId(args.post_id) });
  }
}

export class DeletePostController {
  constructor(private readonly useCase: DeletePostInputBoundary) {}

  handle(actor: Actor, args: PostArgs): Promise<void> {
    return this.useCase.execute({ actor, postId: postId(args.post_id) });
  }
}
