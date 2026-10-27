import type { Instant } from "../../entities/time/instant";
import type { Clock } from "../../use_cases/ports/clock";
import type { LockResult, Locks, PublishLock, TokenLock } from "../../use_cases/ports/locks";
import type { FlightResult, SingleFlight } from "../../use_cases/ports/single_flight";

/** A wait that ends once a clock passes an instant; `cancel` drops it if it is no longer needed. */
export interface DeadlineWait {
  readonly passed: Promise<void>;
  cancel(): void;
}

/** Lets a lock waiter stop waiting at its deadline: real timers in workerd, the clock in tests. */
export interface DeadlineTimer {
  /** Settles once the clock reads later than `deadline`. */
  after(deadline: Instant): DeadlineWait;
}

/**
 * A promise-chain mutex, the same construction the Durable Object uses (proved to serialise across
 * `await`, plan §1.1). A waiter with a deadline stops waiting when the deadline passes, even while
 * the holder still runs (plan §3.3 #1, §3.1.1): its slot in the chain is kept and freed when the
 * holder releases, so the lock order is unchanged.
 */
export class AsyncMutex implements PublishLock, TokenLock {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly clock: Clock,
    private readonly timer: DeadlineTimer,
  ) {}

  run<T>(fn: () => Promise<T>): Promise<T>;
  run<T>(fn: () => Promise<T>, deadline: Instant | null): Promise<LockResult<T>>;
  run<T>(fn: () => Promise<T>, deadline?: Instant | null): Promise<T | LockResult<T>> {
    const previous = this.tail;
    let release = (): void => undefined;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    const hold = async <R>(body: () => Promise<R>): Promise<R> => {
      try {
        return await body();
      } finally {
        release();
      }
    };
    if (deadline === undefined) {
      return previous.then(() => hold(fn));
    }
    if (deadline === null) {
      return previous.then(() => hold(async () => ({ acquired: true, value: await fn() })));
    }
    return this.waitUntil(previous, deadline).then((freed) => {
      if (!freed) {
        void previous.then(release);
        return { acquired: false };
      }
      return hold(async () =>
        this.clock.now() > deadline ? { acquired: false } : { acquired: true, value: await fn() },
      );
    });
  }

  /** True once `previous` frees the lock, false if the deadline passes first. */
  private async waitUntil(previous: Promise<void>, deadline: Instant): Promise<boolean> {
    if (this.clock.now() > deadline) {
      return false;
    }
    const wait = this.timer.after(deadline);
    try {
      return await Promise.race([previous.then(() => true), wait.passed.then(() => false)]);
    } finally {
      wait.cancel();
    }
  }
}

export class MemoryLocks implements Locks {
  readonly publish: AsyncMutex;
  readonly token: AsyncMutex;

  constructor(clock: Clock, timer: DeadlineTimer) {
    this.publish = new AsyncMutex(clock, timer);
    this.token = new AsyncMutex(clock, timer);
  }
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
