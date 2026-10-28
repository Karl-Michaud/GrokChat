/**
 * The use-case graph inside an account's Durable Object (plan §3.5, m6): its runtime (D1, R2, the
 * object's token storage, locks and single-flight) and, per invocation, the real X drivers and the
 * run services over them, around that invocation's meter.
 */
import type { AccountId } from "../../entities/identity/ids";
import type { BudgetMeter } from "../../use_cases/ports/budget_meter";
import type { Clock } from "../../use_cases/ports/clock";
import type { Locks } from "../../use_cases/ports/locks";
import type { SingleFlight } from "../../use_cases/ports/single_flight";
import type { TokenStore } from "../../use_cases/ports/token_store";
import { AccountRecovery } from "../../use_cases/run_services/account_recovery";
import { AccountXGatewayService } from "../../use_cases/run_services/account_x_gateway_service";
import { PostsThenFollowers } from "../../use_cases/run_services/account_metrics_run";
import { CollectAccountMetrics } from "../../use_cases/run_services/collect_account_metrics";
import { GuardedTransition } from "../../use_cases/run_services/guarded_transition";
import { MediaStager } from "../../use_cases/run_services/media_stager";
import { PartSender } from "../../use_cases/run_services/part_sender";
import { PublishPost } from "../../use_cases/run_services/publish_post";
import { ReconcileAccount } from "../../use_cases/run_services/reconcile_account";
import { RefreshingTokenProvider } from "../../use_cases/run_services/refreshing_token_provider";
import { SnapshotFollowers } from "../../use_cases/run_services/snapshot_followers";
import { TokenStep } from "../../use_cases/run_services/token_step";
import { XCallRecorder } from "../../use_cases/run_services/x_call_recorder";
import { TokenVault } from "../crypto/token_vault";
import { d1Stores, type D1Stores } from "../d1/d1_stores";
import type { AccountServices, AccountXWiring } from "../durable_objects/account_services";
import { DurableTokenStore } from "../durable_objects/durable_token_store";
import { HttpXWiring } from "../durable_objects/http_x_wiring";
import {
  InvocationAccountPublisher,
  InvocationAccountReconciler,
  InvocationAccountXGateway,
  InvocationMetricsCollector,
  InvocationTokenProvider,
} from "../durable_objects/invocation_services";
import { MemoryLocks, MemorySingleFlight } from "../durable_objects/object_locks";
import { SystemClock } from "../durable_objects/system_clock";
import type { Env } from "../env";
import { R2MediaBlobStore } from "../r2/r2_media_blob_store";
import { xClientCredentials } from "../x_auth/x_oauth_config";
import { FetchTransport } from "../x_http/transport";
import { AccountXUserDirectory } from "../x_http/x_user_directory";

/** What an account's Durable Object runs on: its bindings, its storage, its locks, its clock. */
export interface AccountRuntime {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  readonly tokens: TokenStore;
  /** The two ordered promise-chain mutexes (publish → token), held in the object's memory. */
  readonly locks: Locks;
  readonly flights: SingleFlight;
  readonly clock: Clock;
  /** The X drivers, built per invocation around its meter (plan §3.5). */
  readonly x: AccountXWiring;
}

/** The production runtime of one account's Durable Object. */
export function accountRuntime(
  ctx: DurableObjectState,
  env: Env,
  x: AccountXWiring,
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

/**
 * The production X drivers of one account's object (plan §3.5): `fetch`, metered per invocation,
 * with the X app's credentials for the token refresh, read at the boundary. A missing credential
 * fails the build, so every call to the object fails loudly by the secret's name.
 */
export function productionX(ctx: DurableObjectState, env: Env): AccountXWiring {
  const stores = d1Stores(env.DB);
  return new HttpXWiring({
    transport: new FetchTransport(),
    credentials: xClientCredentials(env),
    recorder: new XCallRecorder(stores.audit, stores.costs),
    users: new AccountXUserDirectory(stores.accounts),
    clock: new SystemClock(),
    defer: (work) => {
      ctx.waitUntil(work);
    },
  });
}

/** One invocation's token provider and X ports, every request spending from its meter (A4). */
function invocationX(runtime: AccountRuntime, id: AccountId, meter: BudgetMeter) {
  const refresher = runtime.x.refresher(id, meter);
  const tokens = new RefreshingTokenProvider(
    runtime.tokens,
    refresher,
    runtime.locks,
    runtime.clock,
  );
  return { tokens, x: runtime.x.calls(meter, tokens) };
}

/** One invocation's use-case graph, around its meter; the runtime's state is the object's. */
export function accountGraph(
  runtime: AccountRuntime,
  stores: D1Stores,
  id: AccountId,
  meter: BudgetMeter,
) {
  const { clock, locks } = runtime;
  const { reader, writer, accounts } = stores;
  const recorder = new XCallRecorder(stores.audit, stores.costs);
  const steps = new GuardedTransition(writer);
  const { tokens, x } = invocationX(runtime, id, meter);
  const blobs = new R2MediaBlobStore(runtime.bucket);
  const stager = new MediaStager({ ...stores, blobs, uploader: x.uploader, recorder });
  const publisher = x.publisher;
  const sender = new PartSender({ ...stores, tokens, publisher, stager, recorder, steps, clock });
  const recovery = new AccountRecovery(reader, writer);
  const tokenStep = new TokenStep(tokens, clock);
  const shared = { reader, accounts, recorder, flights: runtime.flights, clock, tokenStep };
  return {
    tokens,
    publish: new PublishPost({ reader, accounts, locks, clock, recovery, steps, sender }),
    reconcile: new ReconcileAccount({ ...shared, timeline: x.timeline, steps }),
    collect: new PostsThenFollowers(
      new CollectAccountMetrics({ ...shared, metrics: stores.metrics, x: x.metrics }),
      new SnapshotFollowers({ ...shared, days: stores.followers, x: x.users }),
    ),
    gateway: new AccountXGatewayService({
      publisher: x.publisher,
      store: runtime.tokens,
      locks,
      recorder,
      clock,
    }),
  };
}

/**
 * The use-case graph inside an account's Durable Object (plan §3.5, m6). The object's state (the
 * locks, single-flight, token storage) is built once; each call builds its X drivers and the run
 * services over them around its own invocation budget.
 */
export function buildAccountServices(runtime: AccountRuntime): AccountServices {
  const stores = d1Stores(runtime.db);
  const graph = (id: AccountId, meter: BudgetMeter) => accountGraph(runtime, stores, id, meter);
  return {
    publisher: new InvocationAccountPublisher((id, meter) => graph(id, meter).publish),
    reconciler: new InvocationAccountReconciler((id, meter) => graph(id, meter).reconcile),
    collector: new InvocationMetricsCollector((id, meter) => graph(id, meter).collect),
    gateway: new InvocationAccountXGateway((id, meter) => graph(id, meter).gateway, runtime.clock),
    tokens: new InvocationTokenProvider((id, meter) => graph(id, meter).tokens),
  };
}
