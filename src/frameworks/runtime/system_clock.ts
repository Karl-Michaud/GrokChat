import type { Instant } from "../../entities/time/instant";
import type { Clock } from "../../use_cases/ports/clock";
import type { IdGenerator } from "../../use_cases/ports/id_generator";

/** The Worker's clock. */
export class SystemClock implements Clock {
  now(): Instant {
    return Date.now();
  }
}

/** Random v4 UUIDs from WebCrypto. */
export class RandomIds implements IdGenerator {
  newId(): string {
    return crypto.randomUUID();
  }
}
