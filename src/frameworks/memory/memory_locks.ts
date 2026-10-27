import type { Instant } from "../../entities/time/instant";
import type { Clock } from "../../use_cases/ports/clock";
import type { LockResult, Locks, PublishLock, TokenLock } from "../../use_cases/ports/locks";
import type { FlightResult, SingleFlight } from "../../use_cases/ports/single_flight";

/**
 * A promise-chain mutex, the same construction the Durable Object uses (proved to serialise across
 * `await`, plan §1.1). A waiter whose deadline has passed by the time the lock frees gives up.
 */
export class AsyncMutex implements PublishLock, TokenLock {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly clock: Clock) {}

  run<T>(fn: () => Promise<T>): Promise<T>;
  run<T>(fn: () => Promise<T>, deadline: Instant | null): Promise<LockResult<T>>;
  run<T>(fn: () => Promise<T>, deadline?: Instant | null): Promise<T | LockResult<T>> {
    const previous = this.tail;
    let release = (): void => undefined;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    const guarded = async (): Promise<T | LockResult<T>> => {
      await previous;
      try {
        if (deadline === undefined) {
          return await fn();
        }
        if (deadline !== null && this.clock.now() > deadline) {
          return { acquired: false };
        }
        return { acquired: true, value: await fn() };
      } finally {
        release();
      }
    };
    return guarded();
  }
}

export class MemoryLocks implements Locks {
  readonly publish: AsyncMutex;
  readonly token: AsyncMutex;

  constructor(clock: Clock) {
    this.publish = new AsyncMutex(clock);
    this.token = new AsyncMutex(clock);
  }
}

/** No lock at all: the negative control that proves the concurrency tests can fail. */
export class NoLocks implements Locks {
  readonly publish: PublishLock = {
    run: async <T>(fn: () => Promise<T>): Promise<LockResult<T>> => ({
      acquired: true,
      value: await fn(),
    }),
  };
  readonly token: TokenLock = { run: <T>(fn: () => Promise<T>): Promise<T> => fn() };
}

export class MemorySingleFlight implements SingleFlight {
  private readonly running = new Set<string>();

  async tryRun<T>(key: string, fn: () => Promise<T>): Promise<FlightResult<T>> {
    if (this.running.has(key)) {
      return { ran: false };
    }
    this.running.add(key);
    try {
      return { ran: true, value: await fn() };
    } finally {
      this.running.delete(key);
    }
  }
}
