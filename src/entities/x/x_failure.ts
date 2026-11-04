import type { Instant } from "../time/instant";

/** Who a 429 applies to: one user's window, or the whole app's (plan §1.1). */
export type RateScope = "user" | "app";

/**
 * How an X call failed, as a driver observed it (plan §3.5): before the request left, after it
 * left without a response, or with an HTTP status. A status X sent for the request's content (a
 * 403 for duplicate or forbidden content, a failed media processing) is `content_refused`, so it
 * is told apart from an auth 401/403; `no_token` means the account had no usable token and
 * nothing was sent.
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
    }
  | { readonly kind: "content_refused"; readonly status: number; readonly detail: string }
  | { readonly kind: "no_token" };

export type XResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: XFailure };
