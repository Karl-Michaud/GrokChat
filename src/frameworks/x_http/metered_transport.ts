import type { Millis } from "../../entities/time/instant";
import type { BudgetMeter } from "../../use_cases/ports/budget_meter";
import type { HttpTransport, TransportResult } from "./transport";

/** One `fetch` is one of the invocation's 50 external subrequests, and no Cloudflare call (U16). */
const ONE_FETCH = { cloudflareCalls: 0, externalSubrequests: 1 } as const;

/**
 * The decorator that decrements the invocation's `Budget` for every external request (plan §3.2,
 * A4, U16). Only the transport knows how many requests a port call made (a GIF is INIT, n APPENDs,
 * FINALIZE and STATUS polls; a read may add a token refresh), so every X driver and the token
 * endpoint send through one of these, built per Durable Object invocation around that
 * invocation's meter by the composition root. Workers counts each `fetch` it is asked for, so
 * the subrequest is spent before the call, whatever becomes of it.
 */
export class MeteredTransport implements HttpTransport {
  constructor(
    private readonly inner: HttpTransport,
    private readonly meter: BudgetMeter,
  ) {}

  send(request: Request, timeout: Millis): Promise<TransportResult> {
    this.meter.spend(ONE_FETCH);
    return this.inner.send(request, timeout);
  }
}
