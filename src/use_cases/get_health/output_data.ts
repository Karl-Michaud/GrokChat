import type { HealthStatus } from "../../entities/health";

export interface GetHealthOutputData {
  readonly service: string;
  readonly status: HealthStatus;
  /** Posts PUBLISHING now: a deploy resets every Durable Object, so deploy at 0 (m7). */
  readonly publishing: number;
}
