/** The result of a pure policy: allowed, or refused with a machine-readable reason. */
export interface Allowed {
  readonly allowed: true;
}

export interface Refused<Reason extends string> {
  readonly allowed: false;
  readonly reason: Reason;
}

export type Decision<Reason extends string> = Allowed | Refused<Reason>;

export const ALLOWED: Allowed = { allowed: true };

export function refuse<Reason extends string>(reason: Reason): Refused<Reason> {
  return { allowed: false, reason };
}
