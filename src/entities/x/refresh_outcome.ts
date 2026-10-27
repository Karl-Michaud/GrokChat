import type { TokenSet } from "./token_set";

/** What the token endpoint did with a refresh request, as the driver saw it. */
export type RefreshResult =
  | { readonly kind: "rotated"; readonly tokens: TokenSet }
  | { readonly kind: "not_sent" }
  | { readonly kind: "failed" };

export type RefreshOutcome =
  | { readonly kind: "rotated"; readonly tokens: TokenSet }
  | { readonly kind: "retryable_before_send" }
  | { readonly kind: "retry_with_stored" }
  | { readonly kind: "lost" };

/**
 * Refresh tokens are single-use, and X answers a stale and a revoked token alike (U1, U14), so a
 * failure after the request left means the token is lost — unless the stored refresh token is no
 * longer the one that was sent: then retry once with the stored one, since a stale replay does not
 * revoke newer tokens (U1). Compared under `Locks.token`.
 */
export function refreshOutcome(
  result: RefreshResult,
  sentRefreshToken: string,
  storedRefreshToken: string | null,
  alreadyRetried: boolean,
): RefreshOutcome {
  if (result.kind === "rotated") {
    return { kind: "rotated", tokens: result.tokens };
  }
  if (result.kind === "not_sent") {
    return { kind: "retryable_before_send" };
  }
  const changed = storedRefreshToken !== null && storedRefreshToken !== sentRefreshToken;
  return changed && !alreadyRetried ? { kind: "retry_with_stored" } : { kind: "lost" };
}
