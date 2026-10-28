/**
 * What `TestAccountPublisher` runs on: the production graph (`buildAccountServices`) over the real
 * local D1, R2 and Durable Object storage, with scripted X ports and a manual clock. The test and
 * the Durable Object share one isolate (the plugin runs the entry in the tests' context), so a
 * test sets the harness before its first call to a fresh object, which builds from it lazily.
 */
import { env } from "cloudflare:workers";
import type { Account } from "../../../src/entities/accounts/account";
import { accountId, type AccountId } from "../../../src/entities/identity/ids";
import type { AccountXWiring } from "../../../src/frameworks/durable_objects/account_services";
import { d1Stores } from "../../../src/frameworks/d1/d1_stores";
import {
  FakeXMediaUploader,
  FakeXMetrics,
  FakeXPublisher,
  FakeXTimeline,
  FakeXWorld,
} from "../../../src/frameworks/memory/fake_x";
import { ManualClock } from "../../../src/frameworks/memory/manual_clock";
import { MemoryLocks } from "../../../src/frameworks/durable_objects/object_locks";
import { NoLocks } from "../../../src/frameworks/memory/memory_locks";
import { FakeXTokenEndpoint } from "../../../src/frameworks/memory/memory_tokens";
import {
  accountRuntime,
  type AccountRuntime,
} from "../../../src/frameworks/composition/account_graph";
import { anAccount, T0 } from "../../unit/support/builders";
import { metered, type Meter } from "./metered_d1";

export interface Harness {
  readonly clock: ManualClock;
  readonly x: FakeXWorld;
  readonly publisher: FakeXPublisher;
  readonly uploader: FakeXMediaUploader;
  readonly timeline: FakeXTimeline;
  readonly endpoint: FakeXTokenEndpoint;
  readonly meter: Meter;
  readonly locks: "mutex" | "none";
  /** How many service graphs the objects built: one per object instance. */
  builds: number;
}

let current: Harness | null = null;

export function newHarness(options: { readonly locks?: "mutex" | "none" } = {}): Harness {
  const clock = new ManualClock(T0);
  const x = new FakeXWorld(clock);
  current = {
    clock,
    x,
    publisher: new FakeXPublisher(x),
    uploader: new FakeXMediaUploader(x),
    timeline: new FakeXTimeline(x),
    endpoint: new FakeXTokenEndpoint(clock),
    meter: metered(env.DB),
    locks: options.locks ?? "mutex",
    builds: 0,
  };
  return current;
}

export function harness(): Harness {
  if (current === null) {
    throw new Error("call newHarness() before the first call to a TestAccountPublisher");
  }
  return current;
}

export function testRuntime(ctx: DurableObjectState): AccountRuntime {
  const h = harness();
  h.builds += 1;
  // The fakes take no meter: every invocation gets the same scripted X.
  const calls = {
    publisher: h.publisher,
    uploader: h.uploader,
    timeline: h.timeline,
    metrics: new FakeXMetrics(h.x),
  };
  const x: AccountXWiring = { refresher: () => h.endpoint, calls: () => calls };
  return {
    ...accountRuntime(ctx, env, x),
    db: h.meter.db,
    clock: h.clock,
    locks: h.locks === "none" ? new NoLocks() : new MemoryLocks(h.clock, h.clock),
  };
}

let accounts = 0;

/** A fresh account id, so each test talks to a fresh Durable Object. */
export function freshAccountId(): AccountId {
  accounts += 1;
  return accountId(`acc-do-${String(accounts)}`);
}

export function objectFor(account: AccountId) {
  return env.TEST_ACCOUNT.get(env.TEST_ACCOUNT.idFromName(account));
}

/** An active, disclosed account in D1, and tokens in its object. */
export async function seedAccount(overrides: Partial<Account> = {}): Promise<Account> {
  const account = anAccount({ id: freshAccountId(), ...overrides });
  const stores = d1Stores(env.DB);
  await stores.accounts.save(account);
  const stored = await objectFor(account.id).storeConnectedTokens(
    account.id,
    harness().endpoint.issue(),
  );
  if (!stored.stored) {
    throw new Error("tokens not stored");
  }
  return account;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
