/* eslint-disable max-lines -- the composition root must stay the only module that names concrete
classes (Agents/CLAUDE.md §7.1), and it now wires three surfaces: the MCP tools, the dashboard and
the account's Durable Object. It shrinks below 400 lines when the MCP tools leave the stubs for
the D1 and DO drivers they share with the dashboard. */
/**
 * The composition root: the only module that names concrete classes and wires them together
 * (plan §3, Agents/CLAUDE.md §7.1). It exports the Worker's handlers and the Durable Object class.
 */
import { dispatchScheduled } from "./frameworks/cron/dispatch";
import { TokenVault } from "./frameworks/crypto/token_vault";
import { d1Stores } from "./frameworks/d1/d1_stores";
import { AccountPublisherObject } from "./frameworks/durable_objects/account_publisher";
import type { AccountServices, AccountXPorts } from "./frameworks/durable_objects/account_services";
import { DurableTokenStore } from "./frameworks/durable_objects/durable_token_store";
import { SystemClock } from "./frameworks/durable_objects/system_clock";
import { X_UNAVAILABLE } from "./frameworks/durable_objects/x_unavailable";
import type { Env } from "./frameworks/env";
import { buildHttpApp } from "./frameworks/http/app";
import type { ToolHandlers } from "./frameworks/mcp/mcp_server";
import { mcpRoute } from "./frameworks/mcp/mcp_route";
import { FakeXMediaUploader, FakeXPublisher, FakeXWorld } from "./frameworks/memory/fake_x";
import {
  InProcessAccountPublisher,
  InProcessAccountReconciler,
  InProcessMetricsCollector,
} from "./frameworks/memory/in_process_account";
import { MemoryLocks, MemorySingleFlight } from "./frameworks/memory/memory_locks";
import {
  FnvContentHasher,
  MemoryMediaBlobStore,
  MemoryMediaUsage,
  ScriptedMediaFetcher,
} from "./frameworks/memory/memory_media";
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
import { FakeXTokenEndpoint, MemoryTokenStore } from "./frameworks/memory/memory_tokens";
import { R2MediaBlobStore } from "./frameworks/r2/r2_media_blob_store";
import { RandomIds } from "./frameworks/runtime/random_ids";
import { HealthController } from "./interface_adapters/health/health_controller";
import { HealthPresenter } from "./interface_adapters/health/health_presenter";
import { HealthViewModel, type HealthView } from "./interface_adapters/health/health_view_model";
import {
  CancelPostController,
  CreatePostController,
  CreateThreadController,
  DeletePostController,
  EditPostController,
  StageMediaFromUrlController,
} from "./interface_adapters/mcp/authoring_controllers";
import {
  ComparePostsController,
  GetAccountMetricsController,
  GetPersonalityController,
  GetPolicyController,
  GetPostController,
  GetPostMetricsController,
  ListBacklogController,
} from "./interface_adapters/mcp/reading_controllers";
import { presentTool, type ToolPresenter } from "./interface_adapters/mcp/tool_presenter";
import * as views from "./interface_adapters/mcp/tool_views";
import { AccessGuard } from "./use_cases/access/access_guard";
import { ActionAudit } from "./use_cases/access/action_audit";
import { MediaAttachments } from "./use_cases/authoring/media_attachments";
import { PartsValidator } from "./use_cases/authoring/parts_validator";
import { PostCommand } from "./use_cases/authoring/post_command";
import { CancelPostInteractor } from "./use_cases/cancel_post/interactor";
import { ComparePostsInteractor } from "./use_cases/compare_posts/interactor";
import { CreatePostInteractor } from "./use_cases/create_post/interactor";
import type { CreatePostOutputData } from "./use_cases/create_post/output_data";
import { DeletePostInteractor } from "./use_cases/delete_post/interactor";
import { EditPostInteractor } from "./use_cases/edit_post/interactor";
import { GetAccountMetricsInteractor } from "./use_cases/get_account_metrics/interactor";
import { GetHealthInteractor } from "./use_cases/get_health/interactor";
import { GetPersonalityInteractor } from "./use_cases/get_personality/interactor";
import { GetPolicyInteractor } from "./use_cases/get_policy/interactor";
import { GetPostMetricsInteractor } from "./use_cases/get_post_metrics/interactor";
import { GetPostInteractor } from "./use_cases/get_post/interactor";
import { ListBacklogInteractor } from "./use_cases/list_backlog/interactor";
import { MediaIntake } from "./use_cases/media/media_intake";
import type { Clock } from "./use_cases/ports/clock";
import type { Locks } from "./use_cases/ports/locks";
import type { SingleFlight } from "./use_cases/ports/single_flight";
import type { TokenStore } from "./use_cases/ports/token_store";
import { AccountRecovery } from "./use_cases/run_services/account_recovery";
import { AccountXGatewayService } from "./use_cases/run_services/account_x_gateway_service";
import { CollectAccountMetrics } from "./use_cases/run_services/collect_account_metrics";
import { GuardedTransition } from "./use_cases/run_services/guarded_transition";
import { MediaStager } from "./use_cases/run_services/media_stager";
import { PartSender } from "./use_cases/run_services/part_sender";
import { PublishPost } from "./use_cases/run_services/publish_post";
import { ReconcileAccount } from "./use_cases/run_services/reconcile_account";
import { RefreshingTokenProvider } from "./use_cases/run_services/refreshing_token_provider";
import { TokenStep } from "./use_cases/run_services/token_step";
import { XCallRecorder } from "./use_cases/run_services/x_call_recorder";
import { StageMediaFromUrlInteractor } from "./use_cases/stage_media_from_url/interactor";

import { AccountObjects } from "./frameworks/durable_objects/account_client";
import type { WebControllers } from "./frameworks/web/controllers";
import { buildWebApp } from "./frameworks/web/web_app";
import { AuditedXAccountConnector } from "./frameworks/x_auth/recorded_oauth";
import { XTokenEndpoint } from "./frameworks/x_auth/token_endpoint";
import { WebCryptoPkce } from "./frameworks/x_auth/webcrypto_pkce";
import { HttpXAccountConnector } from "./frameworks/x_auth/x_account_connector_driver";
import { xOAuthConfig } from "./frameworks/x_auth/x_oauth_config";
import { FetchTransport } from "./frameworks/x_http/transport";
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
import { AccountCommand } from "./use_cases/admin/account_command";
import { ApprovePostInteractor } from "./use_cases/approve_post/interactor";
import { AuditListInteractor } from "./use_cases/audit_list/interactor";
import { ConfirmDisclosureInteractor } from "./use_cases/confirm_disclosure/interactor";
import { ConnectAccountBeginInteractor } from "./use_cases/connect_account_begin/interactor";
import { ConnectAccountCompleteInteractor } from "./use_cases/connect_account_complete/interactor";
import { CostTotalsInteractor } from "./use_cases/cost_totals/interactor";
import { GetCalendarInteractor } from "./use_cases/get_calendar/interactor";
import { GetMediaUsageInteractor } from "./use_cases/get_media_usage/interactor";
import { ListAccountsInteractor } from "./use_cases/list_accounts/interactor";
import { ListPersonalitiesInteractor } from "./use_cases/list_personalities/interactor";
import { LoginInteractor } from "./use_cases/login/interactor";
import type { AuditLog } from "./use_cases/ports/audit_log";
import type { PasswordVerifier } from "./use_cases/ports/password_verifier";
import type { XAccountConnector } from "./use_cases/ports/x_account_connector";
import { RejectPostInteractor } from "./use_cases/reject_post/interactor";
import { ReschedulePostInteractor } from "./use_cases/reschedule_post/interactor";
import { SavePersonalityInteractor } from "./use_cases/save_personality/interactor";
import { SetAccountStatusInteractor } from "./use_cases/set_account_status/interactor";
import { SetPolicyInteractor } from "./use_cases/set_policy/interactor";
function handleHealth(): HealthView {
  const viewModel = new HealthViewModel();
  new HealthController(new GetHealthInteractor(new HealthPresenter(viewModel))).health();
  return viewModel.current();
}

/**
 * The PR 2 in-memory stubs behind the MCP tools. The D1, DO and R2 drivers (PR 3) run the
 * account's Durable Object below; the tools move onto them when the X drivers (PR 4) are wired.
 */
function stubStores() {
  const clock = new SystemClock();
  const audit = new MemoryAuditLog();
  const costs = new MemoryCostLedger();
  const metrics = new MemoryMetricsRepository();
  const table = new MemoryPostTable();
  const x = new FakeXWorld(clock);
  return {
    clock,
    ids: new RandomIds(),
    audit,
    costs,
    metrics,
    table,
    reader: new MemoryPostReader(table, metrics),
    writer: new MemoryPostWriter(table, audit, costs),
    accounts: new MemoryAccountRepository(),
    personalities: new MemoryPersonalityRepository(),
    media: new MemoryMediaRepository(),
    blobs: new MemoryMediaBlobStore(),
    usage: new MemoryMediaUsage(),
    fetcher: new ScriptedMediaFetcher(),
    locks: new MemoryLocks(clock, clock),
    tokenStore: new MemoryTokenStore(),
    tokenEndpoint: new FakeXTokenEndpoint(clock),
    x,
    xPublisher: new FakeXPublisher(x),
    uploader: new FakeXMediaUploader(x),
  };
}

type StubStores = ReturnType<typeof stubStores>;

/** The run services over the stub stores, as `buildAccountServices` hosts them in the object. */
function stubPublishing(s: StubStores) {
  const recorder = new XCallRecorder(s.audit, s.costs);
  const steps = new GuardedTransition(s.writer);
  const tokens = new RefreshingTokenProvider(s.tokenStore, s.tokenEndpoint, s.locks, s.clock);
  const stager = new MediaStager({ ...s, recorder });
  const sender = new PartSender({ ...s, tokens, publisher: s.xPublisher, stager, recorder, steps });
  const recovery = new AccountRecovery(s.reader, s.writer);
  const publishPost = new PublishPost({ ...s, recovery, steps, sender });
  const gateway = new AccountXGatewayService({
    publisher: s.xPublisher,
    store: s.tokenStore,
    locks: s.locks,
    recorder,
    clock: s.clock,
  });
  return { steps, gateway, accountPublisher: new InProcessAccountPublisher(publishPost) };
}

function stubBackend() {
  const stores = stubStores();
  const publishing = stubPublishing(stores);
  const actionAudit = new ActionAudit(stores.audit, stores.clock);
  const guard = new AccessGuard(actionAudit);
  return {
    ...stores,
    ...publishing,
    actionAudit,
    guard,
    validator: new PartsValidator(stores.media),
    attachments: new MediaAttachments(stores.media),
    command: new PostCommand(stores.reader, publishing.steps, guard, actionAudit),
    intake: new MediaIntake({ ...stores, hasher: new FnvContentHasher(), audit: actionAudit }),
  };
}

type Backend = ReturnType<typeof stubBackend>;

/**
 * The stub backend for this isolate, exported so the integration tests can seed accounts. It goes
 * when the tools are wired to the D1 and DO drivers. Until then the MCP tools and the dashboard
 * (below, already on D1) do not share data: an account connected in the dashboard is not visible
 * to the tools.
 */
export const stubs: Backend = stubBackend();

function mediaHosts(env: Env): readonly string[] {
  return (env.GROKCHAT_MEDIA_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

function authoringTools(b: Backend, env: Env) {
  const create = (p: ToolPresenter<CreatePostOutputData>) =>
    new CreatePostInteractor({ ...b, audit: b.actionAudit, publisher: b.accountPublisher }, p);
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
        new StageMediaFromUrlController(
          new StageMediaFromUrlInteractor({ ...b, allowedHosts: mediaHosts(env) }, p),
        ).handle(call.actor, args),
      ),
    edit_post: (call, args) =>
      presentTool(views.postCommandView, call.secrets, (p) =>
        new EditPostController(new EditPostInteractor(b, p)).handle(call.actor, args),
      ),
    cancel_post: (call, args) =>
      presentTool(views.postCommandView, call.secrets, (p) =>
        new CancelPostController(new CancelPostInteractor(b.command, p)).handle(call.actor, args),
      ),
    delete_post: (call, args) =>
      presentTool(views.deletePostView, call.secrets, (p) =>
        new DeletePostController(
          new DeletePostInteractor({ ...b, audit: b.actionAudit }, p),
        ).handle(call.actor, args),
      ),
  } satisfies Partial<ToolHandlers>;
}

function postReadingTools(b: Backend) {
  return {
    get_post: (call, args) =>
      presentTool(views.getPostView, call.secrets, (p) =>
        new GetPostController(new GetPostInteractor(b.reader, b.guard, p)).handle(call.actor, args),
      ),
    list_backlog: (call, args) =>
      presentTool(views.listBacklogView, call.secrets, (p) =>
        new ListBacklogController(new ListBacklogInteractor(b.reader, b.guard, p)).handle(
          call.actor,
          args,
        ),
      ),
    get_post_metrics: (call, args) =>
      presentTool(views.postMetricsView, call.secrets, (p) =>
        new GetPostMetricsController(
          new GetPostMetricsInteractor(b.reader, b.metrics, b.guard, p),
        ).handle(call.actor, args),
      ),
  } satisfies Partial<ToolHandlers>;
}

function accountReadingTools(b: Backend) {
  return {
    get_account_metrics: (call, args) =>
      presentTool(views.accountMetricsView, call.secrets, (p) =>
        new GetAccountMetricsController(
          new GetAccountMetricsInteractor(b.metrics, b.guard, p),
        ).handle(call.actor, args),
      ),
    compare_posts: (call, args) =>
      presentTool(views.comparePostsView, call.secrets, (p) =>
        new ComparePostsController(new ComparePostsInteractor(b.metrics, b.guard, p)).handle(
          call.actor,
          args,
        ),
      ),
    get_personality: (call, args) =>
      presentTool(views.personalityView, call.secrets, (p) =>
        new GetPersonalityController(
          new GetPersonalityInteractor(b.accounts, b.personalities, b.guard, p),
        ).handle(call.actor, args),
      ),
    get_policy: (call, args) =>
      presentTool(views.policyView, call.secrets, (p) =>
        new GetPolicyController(new GetPolicyInteractor(b.accounts, b.guard, p)).handle(
          call.actor,
          args,
        ),
      ),
  } satisfies Partial<ToolHandlers>;
}

function toolHandlers(env: Env): ToolHandlers {
  return {
    ...authoringTools(stubs, env),
    ...postReadingTools(stubs),
    ...accountReadingTools(stubs),
  };
}

// ---- Dashboard (PR 7) -------------------------------------------------------------------------
// The dashboard runs on the D1 repositories (GROKCHAT-8) and reaches X only through the account's
// Durable Object (`AccountObjects`: deletes and storing a connect's tokens) and the X OAuth
// connector (GROKCHAT-9). Built once per `env`, so per isolate.

/** The X OAuth connector, built when a connect starts or finishes: its secrets fail loudly there. */
function xConnector(env: Env, audit: AuditLog, clock: Clock): XAccountConnector {
  const config = xOAuthConfig(env);
  const transport = new FetchTransport();
  const endpoint = new XTokenEndpoint(transport, config);
  const http = new HttpXAccountConnector(config, endpoint, transport, clock);
  return new AuditedXAccountConnector(http, audit, clock);
}

function dashboardBackend(env: Env) {
  const clock = new SystemClock();
  const stores = d1Stores(env.DB);
  const { audit, reader, accounts } = stores;
  const actionAudit = new ActionAudit(audit, clock);
  const guard = new AccessGuard(actionAudit);
  const steps = new GuardedTransition(stores.writer);
  return {
    ...{ ...stores, clock, actionAudit, guard, steps },
    gateway: new AccountObjects(env.ACCOUNT),
    connector: (): XAccountConnector => xConnector(env, audit, clock),
    ids: new RandomIds(),
    pkce: new WebCryptoPkce(),
    command: new PostCommand(reader, steps, guard, actionAudit),
    accountCommand: new AccountCommand(accounts, guard, actionAudit),
  };
}

type DashboardBackend = ReturnType<typeof dashboardBackend>;

function postUseCases(b: DashboardBackend): PostPageUseCases & PostCommandUseCases {
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

function accountUseCases(
  b: DashboardBackend,
): AccountUseCases & OAuthUseCases & PersonalityUseCases {
  const { guard, accountCommand, states, ids, clock } = b;
  const connect = { states, ids, clock, guard, audit: b.actionAudit, accounts: b.accounts };
  return {
    listAccounts: (p) => new ListAccountsInteractor(b.accounts, guard, p),
    listPersonalities: (p) => new ListPersonalitiesInteractor(b.personalities, guard, p),
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
        {
          ...connect,
          personalities: b.personalities,
          connector: b.connector(),
          gateway: b.gateway,
        },
        p,
      ),
    savePersonality: (p) =>
      new SavePersonalityInteractor(b.personalities, ids, guard, b.actionAudit, p),
  };
}

function reportUseCases(b: DashboardBackend): ReportUseCases {
  const { guard } = b;
  return {
    listAccounts: (p) => new ListAccountsInteractor(b.accounts, guard, p),
    accountMetrics: (p) => new GetAccountMetricsInteractor(b.metrics, guard, p),
    costTotals: (p) => new CostTotalsInteractor(b.costs, guard, p),
    mediaUsage: (p) => new GetMediaUsageInteractor(b.usage, guard, b.clock, p),
    auditList: (p) => new AuditListInteractor(b.audit, guard, p),
  };
}

function dashboardControllers(b: DashboardBackend): WebControllers {
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

type WorkerApp = ReturnType<typeof buildHttpApp>;

const mcp = mcpRoute(toolHandlers);
const apps = new WeakMap<Env, WorkerApp>();

/** The Worker's routes over this `env`'s bindings, built on its first request. */
function workerApp(env: Env): WorkerApp {
  let app = apps.get(env);
  if (app === undefined) {
    const web = buildWebApp(dashboardControllers(dashboardBackend(env)));
    app = buildHttpApp({ health: handleHealth, mcp, web });
    apps.set(env, app);
  }
  return app;
}

export default {
  fetch: (request, env, ctx) => workerApp(env).fetch(request, env, ctx),
  scheduled: () => dispatchScheduled(),
} satisfies ExportedHandler<Env>;

/** What an account's Durable Object runs on: its bindings, its storage, its locks, its clock. */
export interface AccountRuntime {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  readonly tokens: TokenStore;
  /** The two ordered promise-chain mutexes (publish → token), held in the object's memory. */
  readonly locks: Locks;
  readonly flights: SingleFlight;
  readonly clock: Clock;
  readonly x: AccountXPorts;
}

/** The production runtime of one account's Durable Object. */
export function accountRuntime(
  ctx: DurableObjectState,
  env: Env,
  x: AccountXPorts,
): AccountRuntime {
  const clock = new SystemClock();
  const vault = TokenVault.fromSecret(env.GROKCHAT_TOKEN_KEYS);
  return {
    db: env.DB,
    bucket: env.MEDIA,
    tokens: new DurableTokenStore(ctx.storage, vault),
    locks: new MemoryLocks(clock, clock),
    flights: new MemorySingleFlight(),
    clock,
    x,
  };
}

/** The use-case graph inside an account's Durable Object (plan §3.5, m6). */
export function buildAccountServices(runtime: AccountRuntime): AccountServices {
  const { clock, locks, x } = runtime;
  const stores = d1Stores(runtime.db);
  const { reader, writer, accounts } = stores;
  const recorder = new XCallRecorder(stores.audit, stores.costs);
  const steps = new GuardedTransition(writer);
  const tokens = new RefreshingTokenProvider(runtime.tokens, x.refresher, locks, clock);
  const blobs = new R2MediaBlobStore(runtime.bucket);
  const stager = new MediaStager({ ...stores, blobs, uploader: x.uploader, recorder });
  const sender = new PartSender({
    ...stores,
    tokens,
    publisher: x.publisher,
    stager,
    recorder,
    steps,
    clock,
  });
  const recovery = new AccountRecovery(reader, writer);
  const publish = new PublishPost({ reader, accounts, locks, clock, recovery, steps, sender });
  const tokenStep = new TokenStep(tokens, clock);
  const shared = { reader, accounts, recorder, flights: runtime.flights, clock, tokenStep };
  return {
    publisher: new InProcessAccountPublisher(publish),
    reconciler: new InProcessAccountReconciler(
      new ReconcileAccount({ ...shared, timeline: x.timeline, steps }),
    ),
    collector: new InProcessMetricsCollector(
      new CollectAccountMetrics({ ...shared, metrics: stores.metrics, x: x.metrics }),
    ),
    gateway: new AccountXGatewayService({
      publisher: x.publisher,
      store: runtime.tokens,
      locks,
      recorder,
      clock,
    }),
    tokens,
  };
}

/**
 * The account's Durable Object, bound as ACCOUNT. Its X ports stay unavailable until the X drivers
 * (PR 4) are wired here, per invocation around its `BudgetMeter` (plan §3.5): nothing is sent, and
 * every due part waits as a retryable failure.
 */
export class AccountPublisher extends AccountPublisherObject {
  protected build(): AccountServices {
    return buildAccountServices(accountRuntime(this.ctx, this.env, X_UNAVAILABLE));
  }
}
