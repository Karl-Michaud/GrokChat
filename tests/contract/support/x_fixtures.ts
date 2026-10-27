/**
 * Fetch fixtures for the X drivers, shaped from docs.x.com (create-post, delete-post, media
 * upload, get-posts-by-ids, user-posts-timeline, rate-limits, oauth2 token) and the U1/U4/U14
 * spike responses in `docs/spikes/spike-x-oauth/`.
 */
import type { Millis } from "../../../src/entities/time/instant";
import type { HttpTransport, TransportResult } from "../../../src/frameworks/x_http/transport";
import type { AccessTokenResult, TokenProvider } from "../../../src/use_cases/ports/token_provider";

/** One request as the transport saw it, with its body read as text. */
export interface SeenRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: string;
  readonly form: FormData | null;
  readonly timeout: Millis;
}

export type Reply = TransportResult | ((request: SeenRequest) => TransportResult);

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const respond = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): TransportResult => ({ kind: "response", response: json(status, body, headers) });

export const NOT_SENT: TransportResult = { kind: "not_sent", reason: "connect refused" };
export const NO_RESPONSE: TransportResult = { kind: "no_response", reason: "timeout" };

/** Answers each request with the next scripted reply (or `fallback`), and keeps what it saw. */
export class FixtureTransport implements HttpTransport {
  readonly seen: SeenRequest[] = [];
  readonly replies: Reply[] = [];

  constructor(private readonly fallback: Reply = respond(500, { title: "unscripted" })) {}

  script(...replies: Reply[]): this {
    this.replies.push(...replies);
    return this;
  }

  async send(request: Request, timeout: Millis): Promise<TransportResult> {
    const isForm = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
    const form = isForm ? await request.clone().formData() : null;
    const seen: SeenRequest = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: isForm ? "" : await request.text(),
      form,
      timeout,
    };
    this.seen.push(seen);
    const reply = this.replies.shift() ?? this.fallback;
    return typeof reply === "function" ? reply(seen) : reply;
  }
}

/** A token provider that hands out one fixed result. */
export class FixedTokens implements TokenProvider {
  readonly deadlines: number[] = [];

  constructor(public result: AccessTokenResult = { kind: "token", accessToken: "access-1" }) {}

  accessToken(_account: unknown, deadline: number): Promise<AccessTokenResult> {
    this.deadlines.push(deadline);
    return Promise.resolve(this.result);
  }
}

/** docs.x.com problem bodies. */
export const PROBLEMS = {
  duplicate: {
    title: "Forbidden",
    type: "about:blank",
    status: 403,
    detail: "You are not allowed to create a Tweet with duplicate content.",
  },
  videoTooLong: {
    title: "Forbidden",
    type: "about:blank",
    status: 403,
    detail: "This user is not allowed to post a video longer than 20 minutes.",
  },
  unsupportedAuth: {
    title: "Unsupported Authentication",
    detail:
      "Authenticating with OAuth 2.0 Application-Only is forbidden for this endpoint.  Supported authentication types are [OAuth 1.0a User Context, OAuth 2.0 User Context].",
    type: "https://api.x.com/2/problems/unsupported-authentication",
    status: 403,
  },
  clientForbidden: {
    client_id: "123",
    detail:
      "When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project.",
    registration_url: "https://developer.x.com/en/docs/projects/overview",
    title: "Client Forbidden",
    required_enrollment: "Appropriate Level of API Access",
    reason: "client-not-enrolled",
    type: "https://api.x.com/2/problems/client-forbidden",
  },
  bareForbidden: { title: "Forbidden", type: "about:blank", status: 403, detail: "Forbidden" },
  unauthorized: { title: "Unauthorized", type: "about:blank", status: 401, detail: "Unauthorized" },
  invalidRequest: {
    type: "https://api.x.com/2/problems/invalid-request",
    title: "Invalid Request",
    detail: "One or more parameters to your request was invalid.",
    status: 400,
  },
  rateLimited: { errors: [{ code: 88, message: "Rate limit exceeded" }] },
  serverError: { title: "Service Unavailable", detail: "Service Unavailable", status: 503 },
} as const;

/** The 15-minute user window exhausted (`x-rate-limit-reset` is epoch seconds). */
export const userWindowHeaders = (resetSeconds: number): Record<string, string> => ({
  "x-rate-limit-limit": "100",
  "x-rate-limit-remaining": "0",
  "x-rate-limit-reset": String(resetSeconds),
});

/** The app's 24-hour window exhausted. */
export const appWindowHeaders = (resetSeconds: number): Record<string, string> => ({
  "x-rate-limit-limit": "100",
  "x-rate-limit-remaining": "57",
  "x-rate-limit-reset": String(resetSeconds - 3600),
  "x-app-limit-24hour-limit": "10000",
  "x-app-limit-24hour-remaining": "0",
  "x-app-limit-24hour-reset": String(resetSeconds),
});

/** The user's 24-hour window exhausted. */
export const userDayHeaders = (resetSeconds: number): Record<string, string> => ({
  "x-rate-limit-remaining": "40",
  "x-rate-limit-reset": String(resetSeconds - 3600),
  "x-user-limit-24hour-limit": "17",
  "x-user-limit-24hour-remaining": "0",
  "x-user-limit-24hour-reset": String(resetSeconds),
  "x-app-limit-24hour-remaining": "9000",
});

export const created = (id: string, text: string): TransportResult =>
  respond(201, { data: { id, text, edit_history_tweet_ids: [id] } });

export const DELETED = respond(200, { data: { deleted: true } });

/** A token response as U1 recorded it (no real values). */
export const tokenBody = (n: number) => ({
  token_type: "bearer",
  expires_in: 7200,
  access_token: `access-${String(n)}`,
  scope: "tweet.write users.read tweet.read offline.access media.write",
  refresh_token: `refresh-${String(n)}`,
});

/** U1/U14: a stale, replayed or revoked refresh token. */
export const INVALID_TOKEN = respond(400, {
  error: "invalid_request",
  error_description: "Value passed for the token was invalid.",
});
