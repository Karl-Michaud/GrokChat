/** The name the service reports for itself. */
export const SERVICE_NAME = "grokchat";

export type HealthStatus = "ok";

/** What `/health` reports. Later PRs add the count of PUBLISHING posts (plan §3.6, m7). */
export interface Health {
  readonly service: typeof SERVICE_NAME;
  readonly status: HealthStatus;
}

export function currentHealth(): Health {
  return Object.freeze({ service: SERVICE_NAME, status: "ok" });
}
