import { xUserId } from "../../entities/identity/ids";
import type { TokenSet } from "../../entities/x/token_set";
import type { Clock } from "../../use_cases/ports/clock";
import type { ConnectedXUser, XAccountConnector } from "../../use_cases/ports/x_account_connector";
import { field, readJson, text } from "../x_http/json_fields";
import type { HttpTransport } from "../x_http/transport";
import { X_API, X_CALL_TIMEOUT } from "../x_http/x_api_client";
import type { XTokenEndpoint } from "./token_endpoint";
import { AUTHORIZE_URL, SCOPES, type XOAuthConfig } from "./x_oauth_config";

/**
 * X's OAuth 2.0 authorization-code flow with PKCE S256 (U1): the authorize URL, then the code
 * exchange as a confidential client and `GET /2/users/me` for who connected. Any failure is null:
 * the owner starts the connect again (the interactor refuses with `oauth_failed`).
 */
export class HttpXAccountConnector implements XAccountConnector {
  constructor(
    private readonly config: XOAuthConfig,
    private readonly endpoint: XTokenEndpoint,
    private readonly transport: HttpTransport,
    private readonly clock: Clock,
  ) {}

  authorizeUrl(state: string, codeChallenge: string): string {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async complete(code: string, verifier: string): Promise<ConnectedXUser | null> {
    const exchanged = await this.endpoint.request(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: verifier,
      },
      this.clock.now(),
    );
    return exchanged.kind === "tokens" ? this.whoAmI(exchanged.tokens) : null;
  }

  private async whoAmI(tokens: TokenSet): Promise<ConnectedXUser | null> {
    const request = new Request(new URL("/2/users/me", X_API), {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    const sent = await this.transport.send(request, X_CALL_TIMEOUT);
    if (sent.kind !== "response" || sent.response.status !== 200) {
      return null;
    }
    let body: unknown;
    try {
      body = await readJson(sent.response);
    } catch {
      return null;
    }
    const id = text(field(field(body, "data"), "id"));
    const handle = text(field(field(body, "data"), "username"));
    return id === null || handle === null ? null : { xUserId: xUserId(id), handle, tokens };
  }
}
