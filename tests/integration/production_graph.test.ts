/// <reference types="vite/client" />
/**
 * The production graph holds no stub driver (GROKCHAT-14): every object reachable from the
 * Worker's graph (the MCP tools and the dashboard), from each cron tick's use case, and from an
 * account Durable Object's per-invocation graph is walked, and none is an instance of a class from
 * src/frameworks/memory. dependency-cruiser's `stubs-only-in-tests` rule guards the imports; this
 * guards the objects actually built over a real env.
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { invocationBudget } from "../../src/entities/budget/budget";
import { accountId } from "../../src/entities/identity/ids";
import { HOUR } from "../../src/entities/time/instant";
import { InvocationBudgetMeter } from "../../src/frameworks/budget/invocation_meter";
import { WebCryptoContentHasher } from "../../src/frameworks/crypto/sha256_hasher";
import {
  accountGraph,
  accountRuntime,
  productionX,
} from "../../src/frameworks/composition/account_graph";
import { cronJobs } from "../../src/frameworks/composition/cron_jobs";
import { workerGraph } from "../../src/frameworks/composition/worker_graph";
import { D1PostReader } from "../../src/frameworks/d1/d1_post_reader";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { AccountObjects } from "../../src/frameworks/durable_objects/account_client";
import { DurableTokenStore } from "../../src/frameworks/durable_objects/durable_token_store";
import { SystemClock } from "../../src/frameworks/durable_objects/system_clock";
import { HttpsMediaFetcher } from "../../src/frameworks/media_fetch/https_media_fetcher";
import { ScriptedMediaFetcher } from "../../src/frameworks/memory/memory_media";
import { R2MediaBlobStore } from "../../src/frameworks/r2/r2_media_blob_store";
import { TickPresenter } from "../../src/interface_adapters/cron/tick_presenter";
import { TickViewModel } from "../../src/interface_adapters/cron/tick_view_model";
import { makeWorld } from "../unit/support/world";

type Constructor = abstract new (...args: never[]) => unknown;

const isClass = (value: unknown): value is Constructor =>
  typeof value === "function" && /^class\b/.test(Function.prototype.toString.call(value));

function classesOf(modules: Record<string, unknown>): ReadonlySet<Constructor> {
  return new Set(
    Object.values(modules).flatMap((module) =>
      Object.values(module as Record<string, unknown>).filter(isClass),
    ),
  );
}

/** Every class src/frameworks/memory exports: the stubs and fakes. */
const STUBS = classesOf(import.meta.glob("../../src/frameworks/memory/*.ts", { eager: true }));
/** Every class src/ exports: the walk follows these, and plain objects and arrays. */
const OURS = classesOf(import.meta.glob("../../src/**/*.ts", { eager: true }));

interface Walk {
  /** The paths of every stub found. */
  readonly stubs: string[];
  /** Every one of our classes the walk reached. */
  readonly reached: Set<Constructor>;
}

function followed(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return (
    Array.isArray(value) ||
    proto === Object.prototype ||
    proto === null ||
    (isClass(value.constructor) && OURS.has(value.constructor))
  );
}

/** Walks own properties from `root`, recording stubs; bindings and vendor objects are leaves. */
function walk(root: unknown, path = "graph", found: Walk = { stubs: [], reached: new Set() }) {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, at: string): void => {
    if (typeof value !== "object" || value === null || seen.has(value)) {
      return;
    }
    seen.add(value);
    const type = value.constructor as Constructor;
    if ([...STUBS].some((stub) => value instanceof stub)) {
      found.stubs.push(`${at}: ${type.name}`);
    }
    if (!followed(value)) {
      return;
    }
    if (OURS.has(type)) {
      found.reached.add(type);
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, `${at}.${key}`);
    }
  };
  visit(root, path);
  return found;
}

const meter = () => new InvocationBudgetMeter(invocationBudget(Date.now() + HOUR));

describe("the stub detector (control)", () => {
  it("knows the stub classes and finds one however deep it sits", () => {
    expect(STUBS.has(ScriptedMediaFetcher)).toBe(true);
    expect(STUBS.has(HttpsMediaFetcher)).toBe(false);
    expect(walk({ a: [{ b: { c: new ScriptedMediaFetcher() } }] }).stubs).toStrictEqual([
      "graph.a.0.b.c: ScriptedMediaFetcher",
    ]);
  });

  it("finds the stubs in the in-memory world the unit tests run on", () => {
    expect(walk(makeWorld()).stubs.length).toBeGreaterThan(10);
  });
});

describe("the production graph contains no stub driver", () => {
  it("the Worker's graph, which the MCP tools and the dashboard run on", () => {
    const graph = workerGraph({
      ...env,
      GROKCHAT_MEDIA_HOSTS: "media.example",
      GROKCHAT_PUBLIC_ORIGIN: "https://grokchat.test",
    });
    const found = walk({ ...graph, connector: graph.connector() });
    expect(found.stubs).toStrictEqual([]);
    for (const driver of [
      D1PostReader,
      AccountObjects,
      R2MediaBlobStore,
      HttpsMediaFetcher,
      WebCryptoContentHasher,
      SystemClock,
    ]) {
      expect(found.reached.has(driver)).toBe(true);
    }
  });

  it("each cron tick's use case", () => {
    const clock = new SystemClock();
    const jobs = cronJobs({ db: env.DB, accounts: env.ACCOUNT, bucket: env.MEDIA, clock });
    for (const job of [jobs.publish, jobs.reconcile, jobs.metrics]) {
      const found = walk(job.build(meter(), new TickPresenter(new TickViewModel())));
      expect(found.stubs).toStrictEqual([]);
      expect(found.reached.has(AccountObjects)).toBe(true);
    }
  });

  it("an account Durable Object's per-invocation graph, on the real X drivers", async () => {
    const id = accountId("graph-walk");
    const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(id));
    const found = await runInDurableObject(stub, (_instance, state) => {
      const runtime = accountRuntime(state, env, productionX(state, env));
      return walk({ runtime, graph: accountGraph(runtime, d1Stores(env.DB), id, meter()) });
    });
    expect(found.stubs).toStrictEqual([]);
    for (const driver of [DurableTokenStore, R2MediaBlobStore, D1PostReader, SystemClock]) {
      expect(found.reached.has(driver)).toBe(true);
    }
    expect([...found.reached].map((type) => type.name)).toEqual(
      expect.arrayContaining([
        "HttpXPublisher",
        "HttpXMediaUploader",
        "HttpXOwnTimelineReader",
        "HttpXMetricsReader",
        "MeteredTransport",
        "FetchTransport",
      ]),
    );
  });
});
