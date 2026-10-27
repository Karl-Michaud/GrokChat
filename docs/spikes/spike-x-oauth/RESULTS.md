# U1 results: X OAuth 2.0 refresh tokens (2026-10-27)

`u1_refresh.py`: authorization code + PKCE (S256), confidential client (HTTP Basic at
`POST https://api.x.com/2/oauth2/token`), local callback `http://127.0.0.1:8787/callback` (X accepted it),
scopes `tweet.read tweet.write users.read media.write offline.access`. Raw shapes (no token values):
`results.json`. Developer account had $0 credits; nothing here was billed.

| Step | Result |
|---|---|
| Exchange code | 200; `expires_in` 7200 (2 h); all 5 scopes granted; refresh token issued (91 chars) |
| Refresh with R0 | 200; new access token and **new refresh token R1 ≠ R0** |
| Replay R0 | **400 `invalid_request`, "Value passed for the token was invalid."** (single-use) |
| Refresh with R1 after the replay | 200 → R2; the replay did **not** revoke the family |

Consequences for the design:
- Refresh is single-use and rotating. Per account: serialise refreshes (the account's Durable Object, under its lock); persist the new refresh token before using the new access token; never retry with an old one.
- A stale refresh token returns `invalid_request`, not `invalid_grant`. "Account disconnected" must not be inferred from `invalid_request` alone. Still to measure: the error for a revoked token (after U4, via `POST /2/oauth2/revoke`).
- Connecting accounts needs no credits.

# U14 results: revoked refresh token (2026-10-27)

`u14_revoke.py` (reuses `u1_refresh.py`). Revoke per docs.x.com ("User access token", step 6):
`POST https://api.x.com/2/oauth2/revoke`, form `token` (+ `token_type_hint=refresh_token`, RFC 7009;
the docs example omits the hint), confidential client via HTTP Basic. Shapes/fingerprints only: `u14_results.json`.
No posts; two `GET /2/users/me` reads (~$0.02).

| Step | Result |
|---|---|
| Refresh X_TEST_REFRESH_TOKEN | 200 → A1, R1 (R1 persisted at once) |
| `GET /2/users/me` with A1 | 200 |
| Revoke R1 | 200 `{"revoked": true}` |
| Refresh with revoked R1 | **400 `invalid_request`, "Value passed for the token was invalid."**, byte-identical to U1's stale (replayed) token |
| `GET /2/users/me` with A1 again | **401 Unauthorized**: revoking the refresh token also killed its access token |
| Clean-up | `X_TEST_REFRESH_TOKEN` removed from `GrokChat/.env`; other lines kept, mode 600 |

Consequences for the design:
- A revoked refresh token **cannot be told apart** from a stale (already-rotated) one: same HTTP status, `error`
  and `error_description`. The token endpoint gives no "disconnected" signal.
- `refreshOutcome` should map 400 `invalid_request` (and `invalid_grant`, if it ever appears) to one terminal
  outcome, `reauth_required`, never retried. Because serialised rotation (U1) means our own stored token should
  never be stale, in steady state that error means revoked/disconnected; a lost-write race is the only other cause,
  so the Durable Object should check its stored token is still the one it sent before marking the account disconnected.
- Revocation is immediate for access tokens too: a 401 from a resource call with a non-expired access token is an
  equally strong disconnect signal and should route to the same `reauth_required` path (after one refresh attempt).
