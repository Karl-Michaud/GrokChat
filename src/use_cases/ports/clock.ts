import type { Instant } from "../../entities/time/instant";

export interface Clock {
  now(): Instant;
}
