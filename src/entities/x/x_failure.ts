import type { Instant } from "../time/instant";

/** Who a 429 applies to: one user's window, or the whole app's (plan §1.1). */
export type RateScope = "user" | "app";

/**
 * How an X call failed, as a driver observed it (plan §3.5): before the request left, after it
 * left without a response, or with an HTTP status.
 */
export type XFailure =
  | { readonly kind: "not_sent" }
  | { readonly kind: "no_response" }
  | {
      readonly kind: "http";
      readonly status: number;
      readonly detail: string;
      readonly retryAt: Instant | null;
      readonly scope: RateScope;
    };

export type XResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: XFailure };
