import type { HealthStatus } from "../../entities/health";

export interface GetHealthOutputData {
  readonly service: string;
  readonly status: HealthStatus;
}
