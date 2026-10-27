import type { Millis } from "../../entities/time/instant";

/**
 * What became of one HTTP request (plan §3.5): a response, a failure known to be before the
 * request left (`not_sent`, safe to retry), or a failure after it may have left (`no_response`:
 * X may have acted on it, so a create is never re-sent; reconcile resolves it).
 */
export type TransportResult =
  | { readonly kind: "response"; readonly response: Response }
  | { readonly kind: "not_sent"; readonly reason: string }
  | { readonly kind: "no_response"; readonly reason: string };

/** Sends one request with a timeout. The drivers depend on this, so tests swap in fixtures. */
export interface HttpTransport {
  send(request: Request, timeout: Millis): Promise<TransportResult>;
}

/**
 * Errors that can only happen before a byte of the request left: the connection was never made
 * (refused, DNS, TLS), or Workers refused the subrequest itself (U16). `fetch` gives no structured
 * error, so these are matched by message; anything unrecognised counts as possibly sent.
 */
const BEFORE_SEND =
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS|connect(ion)? (refused|failed)|TLS|SSL|certificate|too many subrequests|too many api requests/i;

/** Classifies a rejected `fetch`: a timeout is after the send; a known connect error is before. */
export function classifyFetchError(error: unknown): TransportResult {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return { kind: "no_response", reason: "timeout" };
  }
  if (BEFORE_SEND.test(message) || BEFORE_SEND.test(cause)) {
    return { kind: "not_sent", reason: message };
  }
  return { kind: "no_response", reason: message };
}

/** The real transport: `fetch` with `AbortSignal.timeout`, never following redirects. */
export class FetchTransport implements HttpTransport {
  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  async send(request: Request, timeout: Millis): Promise<TransportResult> {
    try {
      const response = await this.fetcher(request, {
        signal: AbortSignal.timeout(timeout),
        redirect: "manual",
      });
      return { kind: "response", response };
    } catch (error) {
      return classifyFetchError(error);
    }
  }
}
