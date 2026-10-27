import { TOKEN_STEP_COST } from "../../entities/budget/budget";
import type { AccountId } from "../../entities/identity/ids";
import { MINUTE, type Instant } from "../../entities/time/instant";
import { refreshOutcome } from "../../entities/x/refresh_outcome";
import type { Clock } from "../ports/clock";
import type { Locks } from "../ports/locks";
import type { AccessTokenResult, TokenProvider } from "../ports/token_provider";
import type { TokenStore } from "../ports/token_store";
import type { XTokenRefresher } from "../ports/x_token_refresher";

/** Tokens are refreshed proactively when less than this remains (plan §3.2). */
export const REFRESH_MARGIN = 10 * MINUTE;

const NEEDS_RECONNECT: AccessTokenResult = { kind: "needs_reconnect" };

/**
 * `TokenProvider` as it runs inside the account's Durable Object (plan §3.2, A1, A2, N1): under
 * `Locks.token`, a `REFRESHING` marker is written before the request leaves; the rotated token and
 * the cleared marker are stored in one atomic put before returning. A marker found on entry, or a
 * lost refresh, means `needs_reconnect`, and the old token is never retried.
 */
export class RefreshingTokenProvider implements TokenProvider {
  constructor(
    private readonly store: TokenStore,
    private readonly refresher: XTokenRefresher,
    private readonly locks: Locks,
    private readonly clock: Clock,
  ) {}

  accessToken(account: AccountId, deadline: Instant): Promise<AccessTokenResult> {
    return this.locks.token.run(() => this.locked(account, deadline));
  }

  private async locked(account: AccountId, deadline: Instant): Promise<AccessTokenResult> {
    const stored = await this.store.load(account);
    if (stored?.refreshingSince !== null) {
      return NEEDS_RECONNECT;
    }
    const now = this.clock.now();
    if (stored.tokens.accessExpiresAt - now >= REFRESH_MARGIN) {
      return { kind: "token", accessToken: stored.tokens.accessToken };
    }
    if (now + TOKEN_STEP_COST.millis > deadline) {
      return { kind: "refresh_does_not_fit" };
    }
    return this.refresh(account, stored.tokens.refreshToken, false);
  }

  private async refresh(
    account: AccountId,
    sent: string,
    retried: boolean,
  ): Promise<AccessTokenResult> {
    await this.store.markRefreshing(account, this.clock.now());
    const result = await this.refresher.refresh(sent);
    const latest = await this.store.load(account);
    const outcome = refreshOutcome(result, sent, latest?.tokens.refreshToken ?? null, retried);
    switch (outcome.kind) {
      case "rotated":
        await this.store.commitRotated(account, outcome.tokens);
        return { kind: "token", accessToken: outcome.tokens.accessToken };
      case "retryable_before_send":
        await this.store.clearMarker(account);
        return { kind: "unavailable" };
      case "retry_with_stored":
        return this.refresh(account, outcome.refreshToken, true);
      case "lost":
        return NEEDS_RECONNECT;
    }
  }
}
