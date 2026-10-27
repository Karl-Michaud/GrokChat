/**
 * The composition root: the only module that names concrete classes and wires them together
 * (plan §3, Agents/CLAUDE.md §7.1). It exports the Worker's handlers and the Durable Object class.
 */
import { dispatchScheduled } from "./frameworks/cron/dispatch";
import type { Env } from "./frameworks/env";
import { buildHttpApp } from "./frameworks/http/app";
import { HealthController } from "./interface_adapters/health/health_controller";
import { HealthPresenter } from "./interface_adapters/health/health_presenter";
import { HealthViewModel, type HealthView } from "./interface_adapters/health/health_view_model";
import { GetHealthInteractor } from "./use_cases/get_health/interactor";
import { FakeXPublisher, FakeXWorld } from "./frameworks/memory/fake_x";
import { MemoryLocks } from "./frameworks/memory/memory_locks";
import {
  MemoryLoginThrottle,
  MemoryOAuthStateStore,
  StubXAccountConnector,
} from "./frameworks/memory/memory_auth";
import { MemoryMediaUsage } from "./frameworks/memory/memory_media";
import {
  MemoryPostReader,
  MemoryPostTable,
  MemoryPostWriter,
} from "./frameworks/memory/memory_post_store";
import {
  MemoryAuditLog,
  MemoryCostLedger,
  MemoryMetricsRepository,
} from "./frameworks/memory/memory_records";
import {
  MemoryAccountRepository,
  MemoryMediaRepository,
  MemoryPersonalityRepository,
} from "./frameworks/memory/memory_repositories";
import { MemoryTokenStore } from "./frameworks/memory/memory_tokens";
import type { WebControllers } from "./frameworks/web/controllers";
import { RandomIds, SystemClock, WebCryptoPkce } from "./frameworks/web/crypto_ids";
import { buildWebApp } from "./frameworks/web/web_app";
import { AccountsController } from "./interface_adapters/dashboard/accounts_controller";
import { OAuthController } from "./interface_adapters/dashboard/oauth_controller";
import { PersonalitiesController } from "./interface_adapters/dashboard/personalities_controller";
import { PostCommandsController } from "./interface_adapters/dashboard/post_commands_controller";
import { PostPagesController } from "./interface_adapters/dashboard/post_pages_controller";
import { ReportsController } from "./interface_adapters/dashboard/reports_controller";
import { SessionController } from "./interface_adapters/dashboard/session_controller";
import type {
  AccountUseCases,
  OAuthUseCases,
  PersonalityUseCases,
  PostCommandUseCases,
  PostPageUseCases,
  ReportUseCases,
} from "./interface_adapters/dashboard/use_cases";
import { AccessGuard } from "./use_cases/access/access_guard";
import { ActionAudit } from "./use_cases/access/action_audit";
import { AccountCommand } from "./use_cases/admin/account_command";
import { ApprovePostInteractor } from "./use_cases/approve_post/interactor";
import { AuditListInteractor } from "./use_cases/audit_list/interactor";
import { MediaAttachments } from "./use_cases/authoring/media_attachments";
import { PartsValidator } from "./use_cases/authoring/parts_validator";
import { PostCommand } from "./use_cases/authoring/post_command";
import { CancelPostInteractor } from "./use_cases/cancel_post/interactor";
import { ConfirmDisclosureInteractor } from "./use_cases/confirm_disclosure/interactor";
import { ConnectAccountBeginInteractor } from "./use_cases/connect_account_begin/interactor";
import { ConnectAccountCompleteInteractor } from "./use_cases/connect_account_complete/interactor";
import { CostTotalsInteractor } from "./use_cases/cost_totals/interactor";
import { DeletePostInteractor } from "./use_cases/delete_post/interactor";
import { EditPostInteractor } from "./use_cases/edit_post/interactor";
import { GetAccountMetricsInteractor } from "./use_cases/get_account_metrics/interactor";
import { GetCalendarInteractor } from "./use_cases/get_calendar/interactor";
import { GetMediaUsageInteractor } from "./use_cases/get_media_usage/interactor";
import { GetPostInteractor } from "./use_cases/get_post/interactor";
import { GetPostMetricsInteractor } from "./use_cases/get_post_metrics/interactor";
import { ListAccountsInteractor } from "./use_cases/list_accounts/interactor";
import { ListBacklogInteractor } from "./use_cases/list_backlog/interactor";
import { ListPersonalitiesInteractor } from "./use_cases/list_personalities/interactor";
import { LoginInteractor } from "./use_cases/login/interactor";
import type { PasswordVerifier } from "./use_cases/ports/password_verifier";
import { RejectPostInteractor } from "./use_cases/reject_post/interactor";
import { ReschedulePostInteractor } from "./use_cases/reschedule_post/interactor";
import { GuardedTransition } from "./use_cases/run_services/guarded_transition";
import { AccountXGatewayService } from "./use_cases/run_services/account_x_gateway_service";
import { XCallRecorder } from "./use_cases/run_services/x_call_recorder";
import { SavePersonalityInteractor } from "./use_cases/save_personality/interactor";
import { SetAccountStatusInteractor } from "./use_cases/set_account_status/interactor";
import { SetPolicyInteractor } from "./use_cases/set_policy/interactor";

export { AccountPublisher } from "./frameworks/durable_objects/account_publisher";

function handleHealth(): HealthView {
  const viewModel = new HealthViewModel();
  new HealthController(new GetHealthInteractor(new HealthPresenter(viewModel))).health();
  return viewModel.current();
}

// ---- Dashboard (PR 7) -------------------------------------------------------------------------
// Until PR 3 (D1 + DO) and PR 4 (X) land, the dashboard runs on the in-memory stub backend, kept
// per isolate (Agents/CLAUDE.md §7.2: the stub backend keeps a full run working). Those PRs swap
// the stubs below for their drivers; the controllers and use cases do not change.

function stubStores(clock: SystemClock) {
  const audit = new MemoryAuditLog();
  const costs = new MemoryCostLedger();
  const metrics = new MemoryMetricsRepository();
  const table = new MemoryPostTable();
  return {
    ...{ clock, audit, costs, metrics },
    reader: new MemoryPostReader(table, metrics),
    writer: new MemoryPostWriter(table, audit, costs),
    accounts: new MemoryAccountRepository(),
    media: new MemoryMediaRepository(),
    personalities: new MemoryPersonalityRepository(),
    usage: new MemoryMediaUsage(),
    states: new MemoryOAuthStateStore(),
    throttle: new MemoryLoginThrottle(),
    connector: new StubXAccountConnector(),
    ids: new RandomIds(),
    pkce: new WebCryptoPkce(),
  };
}

function stubBackend() {
  const stores = stubStores(new SystemClock());
  const { clock, audit, costs, reader, accounts } = stores;
  const actionAudit = new ActionAudit(audit, clock);
  const guard = new AccessGuard(actionAudit);
  const steps = new GuardedTransition(stores.writer);
  const gateway = new AccountXGatewayService({
    publisher: new FakeXPublisher(new FakeXWorld(clock)),
    store: new MemoryTokenStore(),
    locks: new MemoryLocks(clock),
    recorder: new XCallRecorder(audit, costs),
    clock,
  });
  return {
    ...{ ...stores, actionAudit, guard, steps, gateway },
    command: new PostCommand(reader, steps, guard, actionAudit),
    accountCommand: new AccountCommand(accounts, guard, actionAudit),
  };
}

type Backend = ReturnType<typeof stubBackend>;

function postUseCases(b: Backend): PostPageUseCases & PostCommandUseCases {
  const { reader, guard, command, clock } = b;
  const authoring = {
    command,
    accounts: b.accounts,
    validator: new PartsValidator(b.media),
    attachments: new MediaAttachments(b.media),
  };
  const deleting = { reader, gateway: b.gateway, steps: b.steps, guard, audit: b.actionAudit };
  return {
    listAccounts: (p) => new ListAccountsInteractor(b.accounts, guard, p),
    listBacklog: (p) => new ListBacklogInteractor(reader, guard, p),
    getCalendar: (p) => new GetCalendarInteractor(reader, guard, p),
    getPost: (p) => new GetPostInteractor(reader, guard, p),
    getPostMetrics: (p) => new GetPostMetricsInteractor(reader, b.metrics, guard, p),
    editPost: (p) => new EditPostInteractor(authoring, p),
    approvePost: (p) => new ApprovePostInteractor(command, clock, p),
    rejectPost: (p) => new RejectPostInteractor(command, p),
    cancelPost: (p) => new CancelPostInteractor(command, p),
    deletePost: (p) => new DeletePostInteractor(deleting, p),
    reschedulePost: (p) => new ReschedulePostInteractor(command, clock, p),
  };
}

function accountUseCases(b: Backend): AccountUseCases & OAuthUseCases & PersonalityUseCases {
  const { guard, accountCommand, states, connector, ids, clock } = b;
  const completing = { ...{ states, connector, ids, clock, guard }, audit: b.actionAudit };
  const connect = { ...completing, accounts: b.accounts, personalities: b.personalities };
  return {
    listAccounts: (p) => new ListAccountsInteractor(b.accounts, guard, p),
    listPersonalities: (p) => new ListPersonalitiesInteractor(b.personalities, guard, p),
    setAccountStatus: (p) => new SetAccountStatusInteractor(accountCommand, p),
    confirmDisclosure: (p) => new ConfirmDisclosureInteractor(accountCommand, p),
    setPolicy: (p) => new SetPolicyInteractor(accountCommand, p),
    connectBegin: (p) =>
      new ConnectAccountBeginInteractor({ states, pkce: b.pkce, connector, guard, ids, clock }, p),
    connectComplete: (p) =>
      new ConnectAccountCompleteInteractor({ ...connect, gateway: b.gateway }, p),
    savePersonality: (p) =>
      new SavePersonalityInteractor(b.personalities, ids, guard, b.actionAudit, p),
  };
}

function reportUseCases(b: Backend): ReportUseCases {
  const { guard } = b;
  return {
    listAccounts: (p) => new ListAccountsInteractor(b.accounts, guard, p),
    accountMetrics: (p) => new GetAccountMetricsInteractor(b.metrics, guard, p),
    costTotals: (p) => new CostTotalsInteractor(b.costs, guard, p),
    mediaUsage: (p) => new GetMediaUsageInteractor(b.usage, guard, b.clock, p),
    auditList: (p) => new AuditListInteractor(b.audit, guard, p),
  };
}

function dashboardControllers(b: Backend): WebControllers {
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
    personalities: new PersonalitiesController(accounts),
    reports: new ReportsController(reportUseCases(b), b.clock),
  };
}

const app = buildHttpApp({
  health: handleHealth,
  web: buildWebApp(dashboardControllers(stubBackend())),
});

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: () => dispatchScheduled(),
} satisfies ExportedHandler<Env>;
