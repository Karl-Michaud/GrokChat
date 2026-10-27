/**
 * The cron ticks' graph (plan §3.3 #5, #6, #8): D1, the account objects and R2, built once per
 * env by main.ts's `scheduled()`.
 */
import { MetricsTickInteractor } from "../../use_cases/metrics_tick/interactor";
import type { BudgetMeter } from "../../use_cases/ports/budget_meter";
import type { Clock } from "../../use_cases/ports/clock";
import { PublishDueTickInteractor } from "../../use_cases/publish_due_tick/interactor";
import { ReconcileTickInteractor } from "../../use_cases/reconcile_tick/interactor";
import { MediaCleanup } from "../../use_cases/run_services/media_cleanup";
import type { CronJobs } from "../cron/dispatch";
import { TICK_WINDOWS } from "../cron/tick_runner";
import { d1Stores } from "../d1/d1_stores";
import { AccountObjects } from "../durable_objects/account_client";
import type { AccountPublisherObject } from "../durable_objects/account_publisher";
import { MeteredAccountDispatch } from "../durable_objects/metered_dispatch";
import { R2MediaBlobStore } from "../r2/r2_media_blob_store";

/** What the cron ticks run on in the Worker: D1, the account objects, R2 and a clock. */
export interface CronPorts {
  readonly db: D1Database;
  readonly accounts: DurableObjectNamespace<AccountPublisherObject>;
  readonly bucket: R2Bucket;
  readonly clock: Clock;
}

/**
 * The three ticks (plan §3.3 #5, #6, #8): each dispatches to the accounts' Durable Objects through
 * one Worker-side client, every call spending the tick's own budget (U16). Recovery runs inside
 * each publish call; reconcile and metrics are single-flight inside each object (m2).
 */
export function cronJobs(ports: CronPorts): CronJobs {
  const { clock } = ports;
  const stores = d1Stores(ports.db);
  const { reader } = stores;
  const objects = new AccountObjects(ports.accounts);
  const dispatch = (meter: BudgetMeter) => new MeteredAccountDispatch(objects, meter);
  const blobs = new R2MediaBlobStore(ports.bucket);
  const cleanup = new MediaCleanup({
    media: stores.media,
    candidates: stores.cleanupCandidates,
    blobs,
    usage: stores.usage,
    clock,
  });
  return {
    publish: {
      job: "publish_due",
      window: TICK_WINDOWS.publish,
      build: (meter, presenter) =>
        new PublishDueTickInteractor(reader, dispatch(meter), meter, clock, presenter),
    },
    reconcile: {
      job: "reconcile",
      window: TICK_WINDOWS.reconcile,
      build: (meter, presenter) =>
        new ReconcileTickInteractor(reader, dispatch(meter), meter, clock, presenter),
    },
    metrics: {
      job: "metrics",
      window: TICK_WINDOWS.metrics,
      build: (meter, presenter) =>
        new MetricsTickInteractor(
          { reader, collector: dispatch(meter), cleanup, meter, clock },
          presenter,
        ),
    },
  };
}
