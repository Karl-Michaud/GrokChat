import type { RefreshResult } from "../../entities/x/refresh_outcome";
import type { Clock } from "../../use_cases/ports/clock";
import type { XTokenRefresher } from "../../use_cases/ports/x_token_refresher";
import type { XTokenEndpoint } from "./token_endpoint";

/**
 * The refresh call `RefreshingTokenProvider` makes under `Locks.token` (plan §3.1, U1, U14):
 * `grant_type=refresh_token`, never cut short. Only a failure before the request left is
 * `not_sent`; every other failure (400 `invalid_request`, a 5xx, a timeout, a 200 without tokens)
 * is `failed`, which `refreshOutcome` resolves to lost unless the stored token changed.
 */
export class HttpXTokenRefresher implements XTokenRefresher {
  constructor(
    private readonly endpoint: XTokenEndpoint,
    private readonly clock: Clock,
  ) {}

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const response = await this.endpoint.request(
      { grant_type: "refresh_token", refresh_token: refreshToken },
      this.clock.now(),
    );
    switch (response.kind) {
      case "tokens":
        return { kind: "rotated", tokens: response.tokens };
      case "not_sent":
        return { kind: "not_sent" };
      case "failed":
        return { kind: "failed" };
    }
  }
}
