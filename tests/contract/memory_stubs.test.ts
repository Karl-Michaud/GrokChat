/** Every in-memory stub against its port's contract (the D1/DO/R2 drivers join in PR 3). */
import { describe, expect, it } from "vitest";
import { invocationBudget } from "../../src/entities/budget/budget";
import { HOUR } from "../../src/entities/time/instant";
import {
  MemoryLoginThrottle,
  MemoryOAuthStateStore,
  SequentialPkce,
  StubXAccountConnector,
} from "../../src/frameworks/memory/memory_auth";
import { InvocationBudgetMeter } from "../../src/frameworks/budget/invocation_meter";
import { MemoryLocks, MemorySingleFlight } from "../../src/frameworks/durable_objects/object_locks";
import { NoLocks } from "../../src/frameworks/memory/memory_locks";
import {
  FnvContentHasher,
  MemoryMediaBlobStore,
  MemoryMediaUsage,
  ScriptedMediaFetcher,
} from "../../src/frameworks/memory/memory_media";
import {
  MemoryPostReader,
  MemoryPostTable,
  MemoryPostWriter,
} from "../../src/frameworks/memory/memory_post_store";
import {
  MemoryAuditLog,
  MemoryCostLedger,
  MemoryMetricsRepository,
} from "../../src/frameworks/memory/memory_records";
import {
  MemoryAccountRepository,
  MemoryMediaRepository,
} from "../../src/frameworks/memory/memory_repositories";
import { ManualClock, SequentialIds } from "../../src/frameworks/memory/manual_clock";
import { MemoryTokenStore } from "../../src/frameworks/memory/memory_tokens";
import { MemoryMediaCleanupCandidates } from "../../src/frameworks/memory/memory_media_cleanup";
import { xUserId } from "../../src/entities/identity/ids";
import { T0 } from "../unit/support/builders";
import {
  budgetMeterContract,
  clockAndIdsContract,
  lockDeadlineContract,
  locksContract,
  singleFlightContract,
} from "./coordination.contract";
import { mediaCleanupCandidatesContract } from "./media_cleanup.contract";
import { postStoreContract } from "./post_store.contract";
import {
  auditLogContract,
  costLedgerContract,
  loginThrottleContract,
  metricsRepositoryContract,
  oauthStateContract,
  tokenStoreContract,
} from "./records.contract";
import {
  accountRepositoryContract,
  blobStoreContract,
  mediaRepositoryContract,
  mediaUsageContract,
} from "./repositories.contract";

describe("memory post store", () => {
  postStoreContract(() => {
    const table = new MemoryPostTable();
    const audit = new MemoryAuditLog();
    const costs = new MemoryCostLedger();
    return {
      reader: new MemoryPostReader(table, new MemoryMetricsRepository()),
      writer: new MemoryPostWriter(table, audit, costs),
      audit,
      costs,
    };
  });
});

describe("memory cleanup candidates", () => {
  mediaCleanupCandidatesContract(() => {
    const table = new MemoryPostTable();
    const media = new MemoryMediaRepository();
    const reader = new MemoryPostReader(table, new MemoryMetricsRepository());
    return {
      candidates: new MemoryMediaCleanupCandidates(media, reader),
      media,
      writer: new MemoryPostWriter(table, new MemoryAuditLog(), new MemoryCostLedger()),
    };
  });
});

describe("memory repositories", () => {
  accountRepositoryContract(() => new MemoryAccountRepository());
  mediaRepositoryContract(() => new MemoryMediaRepository());
  blobStoreContract(() => new MemoryMediaBlobStore());
  mediaUsageContract(() => new MemoryMediaUsage());
});

describe("memory records", () => {
  auditLogContract(() => new MemoryAuditLog());
  costLedgerContract(() => new MemoryCostLedger());
  metricsRepositoryContract(() => new MemoryMetricsRepository());
  oauthStateContract(() => new MemoryOAuthStateStore());
  loginThrottleContract(() => new MemoryLoginThrottle());
  tokenStoreContract(() => new MemoryTokenStore());
});

describe("memory coordination", () => {
  locksContract(() => {
    const clock = new ManualClock(T0);
    return {
      locks: new MemoryLocks(clock, clock),
      advance: (ms) => {
        clock.advance(ms);
      },
    };
  });
  lockDeadlineContract(() => {
    const clock = new ManualClock(T0);
    return {
      locks: new MemoryLocks(clock, clock),
      now: () => clock.now(),
      advance: (ms) => {
        clock.advance(ms);
      },
    };
  });
  singleFlightContract(() => new MemorySingleFlight());
  budgetMeterContract(() => new InvocationBudgetMeter(invocationBudget(T0 + HOUR)));
  clockAndIdsContract(() => ({ clock: new ManualClock(T0), ids: new SequentialIds() }));
});

describe("stub-only helpers", () => {
  it("ManualClock's deadline waits settle only once the clock passes them, and cancel drops them", async () => {
    const clock = new ManualClock(T0);
    await clock.after(T0 - 1).passed;
    const due = clock.after(T0 + 10);
    const dropped = clock.after(T0 + 10);
    const later = clock.after(T0 + 20);
    expect(clock.pendingWaits()).toBe(3);
    dropped.cancel();
    clock.advance(10);
    expect(clock.pendingWaits()).toBe(2);
    clock.set(T0 + 11);
    await due.passed;
    expect(clock.pendingWaits()).toBe(1);
    later.cancel();
    expect(clock.pendingWaits()).toBe(0);
  });

  it("NoLocks runs everything at once (the negative control)", async () => {
    const locks = new NoLocks();
    expect(await locks.publish.run(() => Promise.resolve(1), T0)).toStrictEqual({
      acquired: true,
      value: 1,
    });
    expect(await locks.token.run(() => Promise.resolve(2))).toBe(2);
  });

  it("the fetcher, hasher, PKCE and connector stubs", async () => {
    const fetcher = new ScriptedMediaFetcher();
    expect(await fetcher.fetch("https://a", 1)).toStrictEqual({ ok: false, reason: "unreachable" });
    const hasher = new FnvContentHasher();
    expect(await hasher.sha256Hex(new Uint8Array([1]))).not.toBe(
      await hasher.sha256Hex(new Uint8Array([2])),
    );
    expect(await new SequentialPkce().create()).toStrictEqual({
      verifier: "verifier-1",
      challenge: "challenge-1",
    });
    const connector = new StubXAccountConnector();
    const user = {
      xUserId: xUserId("u"),
      handle: "h",
      tokens: { accessToken: "a", refreshToken: "r", accessExpiresAt: T0 },
    };
    connector.codes.set("c", { verifier: "v", user });
    expect(await connector.complete("c", "wrong")).toBeNull();
    connector.codes.set("c", { verifier: "v", user });
    expect(await connector.complete("c", "v")).toStrictEqual(user);
    expect(await connector.complete("c", "v")).toBeNull();
    const clock = new ManualClock(T0);
    clock.set(T0 + 5);
    expect(clock.now()).toBe(T0 + 5);
    expect(new SequentialIds("p").newId()).toBe("p-1");
  });
});
