/**
 * The 14 MCP tools (plan §3.4; list_accounts since GROKCHAT-16, list_media since GROKCHAT-18) over the Worker's production graph: the same D1 records, account
 * Durable Objects and R2 media as the dashboard, so a bot sees what the dashboard connected.
 */
import {
  CancelPostController,
  CreatePostController,
  CreateThreadController,
  DeletePostController,
  EditPostController,
  StageMediaFromUrlController,
} from "../../interface_adapters/mcp/authoring_controllers";
import {
  ComparePostsController,
  GetAccountMetricsController,
  GetPolicyController,
  GetPostController,
  GetPostMetricsController,
  ListAccountsController,
  ListBacklogController,
  ListMediaController,
} from "../../interface_adapters/mcp/reading_controllers";
import { presentTool, type ToolPresenter } from "../../interface_adapters/mcp/tool_presenter";
import * as views from "../../interface_adapters/mcp/tool_views";
import { CancelPostInteractor } from "../../use_cases/cancel_post/interactor";
import { ComparePostsInteractor } from "../../use_cases/compare_posts/interactor";
import { CreatePostInteractor } from "../../use_cases/create_post/interactor";
import type { CreatePostOutputData } from "../../use_cases/create_post/output_data";
import { DeletePostInteractor } from "../../use_cases/delete_post/interactor";
import { EditPostInteractor } from "../../use_cases/edit_post/interactor";
import { GetAccountMetricsInteractor } from "../../use_cases/get_account_metrics/interactor";
import { GetPolicyInteractor } from "../../use_cases/get_policy/interactor";
import { GetPostMetricsInteractor } from "../../use_cases/get_post_metrics/interactor";
import { GetPostInteractor } from "../../use_cases/get_post/interactor";
import { ListBacklogInteractor } from "../../use_cases/list_backlog/interactor";
import { ListMediaInteractor } from "../../use_cases/list_media/interactor";
import { ListOwnAccountsInteractor } from "../../use_cases/list_own_accounts/interactor";
import { StageMediaFromUrlInteractor } from "../../use_cases/stage_media_from_url/interactor";
import type { ToolHandlers } from "../mcp/mcp_server";
import type { WorkerGraph } from "./worker_graph";

function authoringTools(g: WorkerGraph) {
  const create = (p: ToolPresenter<CreatePostOutputData>) =>
    new CreatePostInteractor({ ...g, audit: g.actionAudit, publisher: g.objects }, p);
  const deleting = { ...g, gateway: g.objects, audit: g.actionAudit };
  return {
    create_post: (call, args) =>
      presentTool(views.createPostView, call.secrets, (p) =>
        new CreatePostController(create(p)).handle(call.actor, args),
      ),
    create_thread: (call, args) =>
      presentTool(views.createPostView, call.secrets, (p) =>
        new CreateThreadController(create(p)).handle(call.actor, args),
      ),
    stage_media_from_url: (call, args) =>
      presentTool(views.stageMediaView, call.secrets, (p) =>
        new StageMediaFromUrlController(new StageMediaFromUrlInteractor(g, p)).handle(
          call.actor,
          args,
        ),
      ),
    edit_post: (call, args) =>
      presentTool(views.postCommandView, call.secrets, (p) =>
        new EditPostController(new EditPostInteractor(g, p)).handle(call.actor, args),
      ),
    cancel_post: (call, args) =>
      presentTool(views.postCommandView, call.secrets, (p) =>
        new CancelPostController(new CancelPostInteractor(g.command, p)).handle(call.actor, args),
      ),
    delete_post: (call, args) =>
      presentTool(views.deletePostView, call.secrets, (p) =>
        new DeletePostController(new DeletePostInteractor(deleting, p)).handle(call.actor, args),
      ),
  } satisfies Partial<ToolHandlers>;
}

function postReadingTools(g: WorkerGraph) {
  return {
    get_post: (call, args) =>
      presentTool(views.getPostView, call.secrets, (p) =>
        new GetPostController(new GetPostInteractor(g.reader, g.guard, p)).handle(call.actor, args),
      ),
    list_backlog: (call, args) =>
      presentTool(views.listBacklogView, call.secrets, (p) =>
        new ListBacklogController(new ListBacklogInteractor(g.reader, g.guard, p)).handle(
          call.actor,
          args,
        ),
      ),
    get_post_metrics: (call, args) =>
      presentTool(views.postMetricsView, call.secrets, (p) =>
        new GetPostMetricsController(
          new GetPostMetricsInteractor(g.reader, g.metrics, g.guard, p),
        ).handle(call.actor, args),
      ),
  } satisfies Partial<ToolHandlers>;
}

function accountReadingTools(g: WorkerGraph) {
  return {
    get_account_metrics: (call, args) =>
      presentTool(views.accountMetricsView, call.secrets, (p) =>
        new GetAccountMetricsController(
          new GetAccountMetricsInteractor(g.metrics, g.guard, p),
        ).handle(call.actor, args),
      ),
    compare_posts: (call, args) =>
      presentTool(views.comparePostsView, call.secrets, (p) =>
        new ComparePostsController(new ComparePostsInteractor(g.metrics, g.guard, p)).handle(
          call.actor,
          args,
        ),
      ),
    get_policy: (call, args) =>
      presentTool(views.policyView, call.secrets, (p) =>
        new GetPolicyController(new GetPolicyInteractor(g.accounts, g.guard, p)).handle(
          call.actor,
          args,
        ),
      ),
    list_accounts: (call) =>
      presentTool(views.listAccountsView, call.secrets, (p) =>
        new ListAccountsController(new ListOwnAccountsInteractor(g.accounts, p)).handle(call.actor),
      ),
    list_media: (call, args) =>
      presentTool(views.listMediaView, call.secrets, (p) =>
        new ListMediaController(new ListMediaInteractor(g, p)).handle(call.actor, args),
      ),
  } satisfies Partial<ToolHandlers>;
}

/** Every tool's handler over one graph. */
export function mcpTools(graph: WorkerGraph): ToolHandlers {
  return {
    ...authoringTools(graph),
    ...postReadingTools(graph),
    ...accountReadingTools(graph),
  };
}
