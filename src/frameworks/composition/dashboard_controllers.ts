/**
 * The dashboard's controllers (plan §3.4, GROKCHAT-15) over the Worker's production graph: the D1
 * records and read models, X reached only through the account's Durable Object (deletes, storing
 * a connect's tokens) and the X OAuth connector. The MCP tools run on the same graph.
 */
import { AccountsController } from "../../interface_adapters/dashboard/accounts_controller";
import { ActivityController } from "../../interface_adapters/dashboard/activity_controller";
import { AnalyticsController } from "../../interface_adapters/dashboard/analytics_controller";
import { OAuthController } from "../../interface_adapters/dashboard/oauth_controller";
import { PostCommandsController } from "../../interface_adapters/dashboard/post_commands_controller";
import { PostsController } from "../../interface_adapters/dashboard/posts_controller";
import { SessionController } from "../../interface_adapters/dashboard/session_controller";
import type {
  AccountDirectory,
  AccountUseCases,
  AnalyticsSource,
  OAuthUseCases,
  PostCommandUseCases,
  PostPageUseCases,
} from "../../interface_adapters/dashboard/use_cases";
import { ApprovePostInteractor } from "../../use_cases/approve_post/interactor";
import { CancelPostInteractor } from "../../use_cases/cancel_post/interactor";
import { ConfirmDisclosureInteractor } from "../../use_cases/confirm_disclosure/interactor";
import { ConnectAccountBeginInteractor } from "../../use_cases/connect_account_begin/interactor";
import { ConnectAccountCompleteInteractor } from "../../use_cases/connect_account_complete/interactor";
import { DeletePostInteractor } from "../../use_cases/delete_post/interactor";
import { EditPostInteractor } from "../../use_cases/edit_post/interactor";
import { GetAnalyticsInteractor } from "../../use_cases/get_analytics/interactor";
import { GetMediaUsageInteractor } from "../../use_cases/get_media_usage/interactor";
import { GetPostInsightsInteractor } from "../../use_cases/get_post_insights/interactor";
import { ListAccountsInteractor } from "../../use_cases/list_accounts/interactor";
import { ListActivityInteractor } from "../../use_cases/list_activity/interactor";
import { ListPostsInteractor } from "../../use_cases/list_posts/interactor";
import { LoginInteractor } from "../../use_cases/login/interactor";
import type { PasswordVerifier } from "../../use_cases/ports/password_verifier";
import { RejectPostInteractor } from "../../use_cases/reject_post/interactor";
import { ReschedulePostInteractor } from "../../use_cases/reschedule_post/interactor";
import { SetAccountStatusInteractor } from "../../use_cases/set_account_status/interactor";
import { SetPolicyInteractor } from "../../use_cases/set_policy/interactor";
import type { WebControllers } from "../web/controllers";
import type { WorkerGraph } from "./worker_graph";

function directory(b: WorkerGraph): AccountDirectory {
  return { listAccounts: (p) => new ListAccountsInteractor(b.accounts, b.guard, p) };
}

function analyticsSource(b: WorkerGraph): AnalyticsSource {
  const { accounts, reader, metrics, followers, costs, guard, clock } = b;
  const ports = { accounts, reader, metrics, followers, costs, guard, clock };
  return { analytics: (p) => new GetAnalyticsInteractor(ports, p) };
}

function postUseCases(b: WorkerGraph): PostPageUseCases & PostCommandUseCases {
  const { reader, guard, command, clock } = b;
  const deleting = { reader, gateway: b.objects, steps: b.steps, guard, audit: b.actionAudit };
  const insights = { reader, metrics: b.metrics, activity: b.activity, guard };
  return {
    ...directory(b),
    listPosts: (p) => new ListPostsInteractor({ reader, metrics: b.metrics, guard }, p),
    insights: (p) => new GetPostInsightsInteractor(insights, p),
    editPost: (p) => new EditPostInteractor(b, p),
    approvePost: (p) => new ApprovePostInteractor(command, clock, p),
    rejectPost: (p) => new RejectPostInteractor(command, p),
    cancelPost: (p) => new CancelPostInteractor(command, p),
    deletePost: (p) => new DeletePostInteractor(deleting, p),
    reschedulePost: (p) => new ReschedulePostInteractor(command, clock, p),
  };
}

function accountUseCases(b: WorkerGraph): AccountUseCases & OAuthUseCases {
  const { guard, accountCommand, states, ids, clock } = b;
  const connect = { states, ids, clock, guard, audit: b.actionAudit, accounts: b.accounts };
  return {
    ...directory(b),
    ...analyticsSource(b),
    setAccountStatus: (p) => new SetAccountStatusInteractor(accountCommand, p),
    confirmDisclosure: (p) => new ConfirmDisclosureInteractor(accountCommand, p),
    setPolicy: (p) => new SetPolicyInteractor(accountCommand, p),
    connectBegin: (p) =>
      new ConnectAccountBeginInteractor(
        { states, pkce: b.pkce, connector: b.connector(), guard, ids, clock },
        p,
      ),
    connectComplete: (p) =>
      new ConnectAccountCompleteInteractor(
        { ...connect, connector: b.connector(), gateway: b.objects },
        p,
      ),
  };
}

function session(b: WorkerGraph) {
  return (verifier: PasswordVerifier) =>
    new SessionController({
      login: (p) =>
        new LoginInteractor(
          { throttle: b.throttle, verifier, audit: b.actionAudit, clock: b.clock },
          p,
        ),
    });
}

export function dashboardControllers(b: WorkerGraph): WebControllers {
  const posts = postUseCases(b);
  const accounts = accountUseCases(b);
  return {
    session: session(b),
    analytics: new AnalyticsController({
      ...directory(b),
      ...analyticsSource(b),
      mediaUsage: (p) => new GetMediaUsageInteractor(b.usage, b.guard, b.clock, p),
    }),
    posts: new PostsController(posts, b.clock),
    postCommands: new PostCommandsController(posts),
    accounts: new AccountsController(accounts),
    oauth: new OAuthController(accounts),
    activity: new ActivityController(
      { ...directory(b), activity: (p) => new ListActivityInteractor(b.activity, b.guard, p) },
      b.clock,
    ),
  };
}
