import { TOKEN_REFRESH_MILLIS } from "../../entities/budget/budget";
import { SECOND, type Instant, type Millis } from "../../entities/time/instant";
import type { TokenSet } from "../../entities/x/token_set";
import { count, field, readJson, text } from "../x_http/json_fields";
import type { HttpTransport } from "../x_http/transport";
import { TOKEN_URL, type XClientCredentials } from "./x_oauth_config";

/**
 * The token call is never cut short (plan §3.5): aborting it after X rotated the refresh token
 * would lose the account. A minute is the floor, and it is the refresh's reserved worst case
 * (`TOKEN_STEP_COST.millis`), so a refresh never runs past what the deadline check allowed.
 */
export const TOKEN_TIMEOUT: Millis = TOKEN_REFRESH_MILLIS;

/** What became of one token request. */
export type TokenResponse =
  | { readonly kind: "tokens"; readonly tokens: TokenSet }
  | { readonly kind: "not_sent" }
  | { readonly kind: "failed"; readonly status: number | null };

/** RFC 6749 §2.3.1: the client id and secret form-encoded, then Basic. */
export function basicAuth(config: XClientCredentials): string {
  const pair = `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`;
  return `Basic ${btoa(pair)}`;
}

function tokenSet(body: unknown, now: Instant): TokenSet | null {
  const accessToken = text(field(body, "access_token"));
  const refreshToken = text(field(body, "refresh_token"));
  const expiresIn = count(field(body, "expires_in"));
  if (accessToken === null || refreshToken === null || expiresIn === null) {
    return null;
  }
  return { accessToken, refreshToken, accessExpiresAt: now + expiresIn * SECOND };
}

/**
 * `POST https://api.x.com/2/oauth2/token` as a confidential client (HTTP Basic, U1). A 200
 * without a refresh token is a failure: X rotated, and nothing usable came back.
 */
export class XTokenEndpoint {
  constructor(
    private readonly transport: HttpTransport,
    private readonly config: XClientCredentials,
  ) {}

  async request(form: Record<string, string>, now: Instant): Promise<TokenResponse> {
    const request = new Request(TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: basicAuth(this.config),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ ...form, client_id: this.config.clientId }).toString(),
    });
    const sent = await this.transport.send(request, TOKEN_TIMEOUT);
    if (sent.kind === "not_sent") {
      return { kind: "not_sent" };
    }
    if (sent.kind === "no_response") {
      return { kind: "failed", status: null };
    }
    const status = sent.response.status;
    const tokens = status === 200 ? tokenSet(await readBody(sent.response), now) : null;
    return tokens === null ? { kind: "failed", status } : { kind: "tokens", tokens };
  }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await readJson(response);
  } catch {
    return null;
  }
}
