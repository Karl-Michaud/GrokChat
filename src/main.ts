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
import { XCallRecorder } from "./use_cases/run_services/x_call_recorder";
import { StageMediaFromUrlInteractor } from "./use_cases/stage_media_from_url/interactor";

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
 * The stub backend for this isolate. Exported so the integration tests can seed accounts until
 * the dashboard (PR 7) exists; it goes when the tools are wired to the D1 and DO drivers (PR 4).
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

const app = buildHttpApp({ health: handleHealth, mcp: mcpRoute(toolHandlers) });

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
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
  const flights = runtime.flights;
  const shared = { reader, accounts, recorder, flights, clock };
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
 * The account's Durable Object, bound as ACCOUNT. Its X ports are unavailable until the X drivers
 * land (PR 4): nothing is sent, and every due part waits as a retryable failure.
 */
export class AccountPublisher extends AccountPublisherObject {
  protected build(): AccountServices {
    return buildAccountServices(accountRuntime(this.ctx, this.env, X_UNAVAILABLE));
  }
}
