/**
 * The dashboard's controllers (plan §3.4) over the Worker's production graph: the D1 records, X
 * reached only through the account's Durable Object (deletes, storing a connect's tokens) and the
 * X OAuth connector. The MCP tools run on the same graph (mcp_tools.ts).
 */
import { AccountsController } from "../../interface_adapters/dashboard/accounts_controller";
import { OAuthController } from "../../interface_adapters/dashboard/oauth_controller";
import { PostCommandsController } from "../../interface_adapters/dashboard/post_commands_controller";
import { PostPagesController } from "../../interface_adapters/dashboard/post_pages_controller";
import { ReportsController } from "../../interface_adapters/dashboard/reports_controller";
import { SessionController } from "../../interface_adapters/dashboard/session_controller";
import type {
  AccountUseCases,
  OAuthUseCases,
  PostCommandUseCases,
  PostPageUseCases,
  ReportUseCases,
} from "../../interface_adapters/dashboard/use_cases";
import { ApprovePostInteractor } from "../../use_cases/approve_post/interactor";
import { AuditListInteractor } from "../../use_cases/audit_list/interactor";
import { CancelPostInteractor } from "../../use_cases/cancel_post/interactor";
import { ConfirmDisclosureInteractor } from "../../use_cases/confirm_disclosure/interactor";
import { ConnectAccountBeginInteractor } from "../../use_cases/connect_account_begin/interactor";
import { ConnectAccountCompleteInteractor } from "../../use_cases/connect_account_complete/interactor";
import { CostTotalsInteractor } from "../../use_cases/cost_totals/interactor";
import { DeletePostInteractor } from "../../use_cases/delete_post/interactor";
import { EditPostInteractor } from "../../use_cases/edit_post/interactor";
import { GetAccountMetricsInteractor } from "../../use_cases/get_account_metrics/interactor";
import { GetCalendarInteractor } from "../../use_cases/get_calendar/interactor";
import { GetMediaUsageInteractor } from "../../use_cases/get_media_usage/interactor";
import { GetPostMetricsInteractor } from "../../use_cases/get_post_metrics/interactor";
import { GetPostInteractor } from "../../use_cases/get_post/interactor";
import { ListAccountsInteractor } from "../../use_cases/list_accounts/interactor";
import { ListBacklogInteractor } from "../../use_cases/list_backlog/interactor";
import { LoginInteractor } from "../../use_cases/login/interactor";
import type { PasswordVerifier } from "../../use_cases/ports/password_verifier";
import { RejectPostInteractor } from "../../use_cases/reject_post/interactor";
import { ReschedulePostInteractor } from "../../use_cases/reschedule_post/interactor";
import { SetAccountStatusInteractor } from "../../use_cases/set_account_status/interactor";
import { SetPolicyInteractor } from "../../use_cases/set_policy/interactor";
import type { WebControllers } from "../web/controllers";
import type { WorkerGraph } from "./worker_graph";

function postUseCases(b: WorkerGraph): PostPageUseCases & PostCommandUseCases {
  const { reader, guard, command, clock } = b;
  const deleting = { reader, gateway: b.objects, steps: b.steps, guard, audit: b.actionAudit };
  return {
    listAccounts: (p) => new ListAccountsInteractor(b.accounts, guard, p),
    listBacklog: (p) => new ListBacklogInteractor(reader, guard, p),
    getCalendar: (p) => new GetCalendarInteractor(reader, guard, p),
    getPost: (p) => new GetPostInteractor(reader, guard, p),
    getPostMetrics: (p) => new GetPostMetricsInteractor(reader, b.metrics, guard, p),
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
    listAccounts: (p) => new ListAccountsInteractor(b.accounts, guard, p),
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

function reportUseCases(b: WorkerGraph): ReportUseCases {
  const { guard } = b;
  return {
    listAccounts: (p) => new ListAccountsInteractor(b.accounts, guard, p),
    accountMetrics: (p) => new GetAccountMetricsInteractor(b.metrics, guard, p),
    costTotals: (p) => new CostTotalsInteractor(b.costs, guard, p),
    mediaUsage: (p) => new GetMediaUsageInteractor(b.usage, guard, b.clock, p),
    auditList: (p) => new AuditListInteractor(b.audit, guard, p),
  };
}

export function dashboardControllers(b: WorkerGraph): WebControllers {
  const posts = postUseCases(b);
  const accounts = accountUseCases(b);
  return {
    session: (verifier: PasswordVerifier) =>
      new SessionController({
        login: (p) =>
          new LoginInteractor(
            { throttle: b.throttle, verifier, audit: b.actionAudit, clock: b.clock },
            p,
          ),
      }),
    postPages: new PostPagesController(posts, b.clock),
    postCommands: new PostCommandsController(posts),
    accounts: new AccountsController(accounts),
    oauth: new OAuthController(accounts),
    reports: new ReportsController(reportUseCases(b), b.clock),
  };
}
