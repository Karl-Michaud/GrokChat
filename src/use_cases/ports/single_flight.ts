export type FlightResult<T> = { readonly ran: true; readonly value: T } | { readonly ran: false };

/** Runs `fn` unless a run for the same key is in progress (reconcile and metrics, m2). */
export interface SingleFlight {
  tryRun<T>(key: string, fn: () => Promise<T>): Promise<FlightResult<T>>;
}
