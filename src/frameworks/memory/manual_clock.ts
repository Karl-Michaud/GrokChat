import type { Instant, Millis } from "../../entities/time/instant";
import type { Clock } from "../../use_cases/ports/clock";
import type { IdGenerator } from "../../use_cases/ports/id_generator";
import type { DeadlineTimer, DeadlineWait } from "./memory_locks";

/**
 * A clock that moves only when told to: every in-memory test is deterministic. Its deadline waits
 * settle when `set` or `advance` moves it past their deadline, never on a real timer.
 */
export class ManualClock implements Clock, DeadlineTimer {
  private readonly waits = new Map<
    symbol,
    { readonly deadline: Instant; readonly fire: () => void }
  >();

  constructor(private current: Instant) {}

  now(): Instant {
    return this.current;
  }

  set(instant: Instant): void {
    this.current = instant;
    for (const [key, wait] of [...this.waits]) {
      if (this.current > wait.deadline) {
        this.waits.delete(key);
        wait.fire();
      }
    }
  }

  advance(by: Millis): void {
    this.set(this.current + by);
  }

  after(deadline: Instant): DeadlineWait {
    const key = Symbol("wait");
    const passed = new Promise<void>((fire) => {
      if (this.current > deadline) {
        fire();
      } else {
        this.waits.set(key, { deadline, fire });
      }
    });
    return {
      passed,
      cancel: () => {
        this.waits.delete(key);
      },
    };
  }

  /** How many deadline waits are still pending (a cancelled or fired wait is gone). */
  pendingWaits(): number {
    return this.waits.size;
  }
}
/** `prefix-1`, `prefix-2`, … */
export class SequentialIds implements IdGenerator {
  private next = 0;

  constructor(private readonly prefix = "id") {}

  newId(): string {
    this.next += 1;
    return `${this.prefix}-${String(this.next)}`;
  }
}
