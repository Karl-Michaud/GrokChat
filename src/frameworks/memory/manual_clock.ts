import type { Instant, Millis } from "../../entities/time/instant";
import type { Clock } from "../../use_cases/ports/clock";
import type { IdGenerator } from "../../use_cases/ports/id_generator";

/** A clock that moves only when told to: every in-memory test is deterministic. */
export class ManualClock implements Clock {
  constructor(private current: Instant) {}

  now(): Instant {
    return this.current;
  }

  set(instant: Instant): void {
    this.current = instant;
  }

  advance(by: Millis): void {
    this.current += by;
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
