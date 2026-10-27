import type { AccountId } from "../../entities/identity/ids";
import { SECOND, type Millis } from "../../entities/time/instant";
import type { XResult } from "../../entities/x/x_failure";
import type { Clock } from "../../use_cases/ports/clock";
import type { TokenProvider } from "../../use_cases/ports/token_provider";
import { readJson } from "./json_fields";
import type { HttpTransport } from "./transport";
import { failureFor } from "./x_errors";

export const X_API = "https://api.x.com";

/** Every X API call is cut off after this (plan §3.5: ≤ 20 s), well inside xAI's 60 s. */
export const X_CALL_TIMEOUT: Millis = 15 * SECOND;

/**
 * A refresh the token provider may need before a call gets this long: the token call is never
 * cut short (plan §3.5), and the caller already refreshed before reserving the part (N1).
 */
export const TOKEN_DEADLINE: Millis = 60 * SECOND;

/** One X API request, built once the access token is known. */
export interface XRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly form?: FormData;
  readonly timeout?: Millis;
}

/**
 * The one place an X API call is made for an account (SRP): the account's access token from
 * `TokenProvider` (inside the account's DO, A1), the request, and the mapping of what came back to
 * an `XResult` of the parsed JSON body (plan §3.5).
 */
export class XApiClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly tokens: TokenProvider,
    private readonly clock: Clock,
  ) {}

  async call(account: AccountId, request: XRequest): Promise<XResult<unknown>> {
    const token = await this.tokens.accessToken(account, this.clock.now() + TOKEN_DEADLINE);
    if (token.kind === "needs_reconnect") {
      return { ok: false, failure: { kind: "no_token" } };
    }
    if (token.kind !== "token") {
      return { ok: false, failure: { kind: "not_sent" } };
    }
    const sent = await this.transport.send(
      buildRequest(request, token.accessToken),
      request.timeout ?? X_CALL_TIMEOUT,
    );
    if (sent.kind !== "response") {
      return { ok: false, failure: { kind: sent.kind } };
    }
    return readResult(sent.response);
  }
}

function buildRequest(request: XRequest, accessToken: string): Request {
  const url = new URL(request.path, X_API);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(name, value);
  }
  const headers = new Headers({ authorization: `Bearer ${accessToken}` });
  let body: string | FormData | null = request.form ?? null;
  if (request.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(request.json);
  }
  return new Request(url, { method: request.method, headers, body });
}

/** A 2xx is the parsed body; anything else is mapped. A body cut off mid-read is no response. */
async function readResult(response: Response): Promise<XResult<unknown>> {
  let body: unknown;
  try {
    body = await readJson(response);
  } catch {
    return { ok: false, failure: { kind: "no_response" } };
  }
  if (response.status >= 200 && response.status < 300) {
    return { ok: true, value: body };
  }
  return { ok: false, failure: failureFor(response.status, response.headers, body) };
}
