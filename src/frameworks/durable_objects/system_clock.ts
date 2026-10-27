import type { Instant } from "../../entities/time/instant";
import type { Clock } from "../../use_cases/ports/clock";

/** The Workers clock. Inside a request it advances only across I/O, which is all the code needs. */
export class SystemClock implements Clock {
  now(): Instant {
    return Date.now();
  }
}
