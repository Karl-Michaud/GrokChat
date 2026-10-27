/** The read-only MCP controllers, one per tool (plan §3.4); framework-free, as the others. */
import type { Actor } from "../../entities/identity/actor";
import { accountId, postId } from "../../entities/identity/ids";
import type { ComparePostsInputBoundary } from "../../use_cases/compare_posts/input_boundary";
import type { GetAccountMetricsInputBoundary } from "../../use_cases/get_account_metrics/input_boundary";
import type { GetPersonalityInputBoundary } from "../../use_cases/get_personality/input_boundary";
import type { GetPolicyInputBoundary } from "../../use_cases/get_policy/input_boundary";
import type { GetPostMetricsInputBoundary } from "../../use_cases/get_post_metrics/input_boundary";
import type { GetPostInputBoundary } from "../../use_cases/get_post/input_boundary";
import type { ListBacklogInputBoundary } from "../../use_cases/list_backlog/input_boundary";
import { optionalWindow, windowArg } from "./time_args";
import type {
  AccountArgs,
  AccountWindowArgs,
  ComparePostsArgs,
  ListBacklogArgs,
  PostArgs,
} from "./tool_args";

export class GetPostController {
  constructor(private readonly useCase: GetPostInputBoundary) {}

  handle(actor: Actor, args: PostArgs): Promise<void> {
    return this.useCase.execute({ actor, postId: postId(args.post_id) });
  }
}

export class ListBacklogController {
  constructor(private readonly useCase: ListBacklogInputBoundary) {}

  handle(actor: Actor, args: ListBacklogArgs): Promise<void> {
    return this.useCase.execute({
      actor,
      accountId: args.account_id === undefined ? null : accountId(args.account_id),
      statuses: args.statuses ?? null,
      window: optionalWindow(args.from, args.to),
    });
  }
}

export class GetPostMetricsController {
  constructor(private readonly useCase: GetPostMetricsInputBoundary) {}

  handle(actor: Actor, args: PostArgs): Promise<void> {
    return this.useCase.execute({ actor, postId: postId(args.post_id) });
  }
}

export class GetAccountMetricsController {
  constructor(private readonly useCase: GetAccountMetricsInputBoundary) {}

  handle(actor: Actor, args: AccountWindowArgs): Promise<void> {
    return this.useCase.execute({
      actor,
      accountId: accountId(args.account_id),
      window: windowArg(args.from, args.to),
    });
  }
}

export class ComparePostsController {
  constructor(private readonly useCase: ComparePostsInputBoundary) {}

  handle(actor: Actor, args: ComparePostsArgs): Promise<void> {
    return this.useCase.execute({
      actor,
      accountId: accountId(args.account_id),
      window: windowArg(args.from, args.to),
      sortBy: args.sort_by,
    });
  }
}

export class GetPersonalityController {
  constructor(private readonly useCase: GetPersonalityInputBoundary) {}

  handle(actor: Actor, args: AccountArgs): Promise<void> {
    return this.useCase.execute({ actor, accountId: accountId(args.account_id) });
  }
}

export class GetPolicyController {
  constructor(private readonly useCase: GetPolicyInputBoundary) {}

  handle(actor: Actor, args: AccountArgs): Promise<void> {
    return this.useCase.execute({ actor, accountId: accountId(args.account_id) });
  }
}
