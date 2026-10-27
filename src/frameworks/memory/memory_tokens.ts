import type { AccountId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import { HOUR } from "../../entities/time/instant";
import type { RefreshResult } from "../../entities/x/refresh_outcome";
import type { TokenSet } from "../../entities/x/token_set";
import type { Clock } from "../../use_cases/ports/clock";
import type { StoredTokens, TokenStore } from "../../use_cases/ports/token_store";
import type { XTokenRefresher } from "../../use_cases/ports/x_token_refresher";

export class MemoryTokenStore implements TokenStore {
  readonly rows = new Map<AccountId, StoredTokens>();

  load(account: AccountId): Promise<StoredTokens | null> {
    return Promise.resolve(this.rows.get(account) ?? null);
  }

  markRefreshing(account: AccountId, at: Instant): Promise<void> {
    const stored = this.rows.get(account);
    if (stored !== undefined) {
      this.rows.set(account, { ...stored, refreshingSince: at });
    }
    return Promise.resolve();
  }

  commitRotated(account: AccountId, tokens: TokenSet): Promise<void> {
    this.rows.set(account, { tokens, refreshingSince: null });
    return Promise.resolve();
  }

  clearMarker(account: AccountId): Promise<void> {
    const stored = this.rows.get(account);
    if (stored !== undefined) {
      this.rows.set(account, { ...stored, refreshingSince: null });
    }
    return Promise.resolve();
  }
}

/**
 * X's token endpoint as U1 measured it: refresh tokens rotate and are single-use; a replayed or
 * revoked one fails; a replay does not revoke newer tokens. `failNext` scripts one outcome.
 */
export class FakeXTokenEndpoint implements XTokenRefresher {
  readonly valid = new Set<string>();
  readonly calls: string[] = [];
  failNext: "not_sent" | "lost_response" | null = null;
  private issued = 0;

  constructor(private readonly clock: Clock) {}

  issue(): TokenSet {
    this.issued += 1;
    const tokens = {
      accessToken: `access-${String(this.issued)}`,
      refreshToken: `refresh-${String(this.issued)}`,
      accessExpiresAt: this.clock.now() + 2 * HOUR,
    };
    this.valid.add(tokens.refreshToken);
    return tokens;
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    await Promise.resolve();
    const failure = this.failNext;
    this.failNext = null;
    if (failure === "not_sent") {
      return { kind: "not_sent" };
    }
    this.calls.push(refreshToken);
    if (!this.valid.delete(refreshToken)) {
      return { kind: "failed" };
    }
    const tokens = this.issue();
    return failure === "lost_response" ? { kind: "failed" } : { kind: "rotated", tokens };
  }
}
