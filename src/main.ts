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
import {
  InProcessAccountPublisher,
  InProcessAccountReconciler,
  InProcessMetricsCollector,
} from "./frameworks/memory/in_process_account";
import { MemoryLocks, MemorySingleFlight } from "./frameworks/memory/memory_locks";
import { R2MediaBlobStore } from "./frameworks/r2/r2_media_blob_store";
import { HealthController } from "./interface_adapters/health/health_controller";
import { HealthPresenter } from "./interface_adapters/health/health_presenter";
import { HealthViewModel, type HealthView } from "./interface_adapters/health/health_view_model";
import { GetHealthInteractor } from "./use_cases/get_health/interactor";
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

function handleHealth(): HealthView {
  const viewModel = new HealthViewModel();
  new HealthController(new GetHealthInteractor(new HealthPresenter(viewModel))).health();
  return viewModel.current();
}

const app = buildHttpApp({ health: handleHealth });

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
