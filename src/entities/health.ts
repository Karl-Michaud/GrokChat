/** The name the service reports for itself. */
export const SERVICE_NAME = "grokchat";

export type HealthStatus = "ok";

/** The service's own part of `/health`; the use case adds the count of PUBLISHING posts (m7). */
export interface Health {
  readonly service: typeof SERVICE_NAME;
  readonly status: HealthStatus;
}

export function currentHealth(): Health {
  return Object.freeze({ service: SERVICE_NAME, status: "ok" });
}
