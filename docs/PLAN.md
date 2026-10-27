# GrokChat v0 — implementation plan (rev 6: Cloudflare + TypeScript)

Status: **converged (rev 6.1).** Architecture red-team converged in round 7, feasibility in round 6 (rounds 5–7 on the Cloudflare design; rounds 1–4 converged on the earlier Vercel/Supabase design).

Previous status: rev 6, after review round 5 (architecture: 6 majors; feasibility: 2 majors). §11 maps every round-5 finding to its change. Rev 5 replaces the Vercel/Supabase/Python design (rev 4, converged, archived as `docs/plan-history/grokchat-v0-plan-rev4-vercel-supabase.md`) after the owner chose Cloudflare only on 2026-10-27. What carries over unchanged from rev 4 (the domain model, the state machine, the policies, the use cases, the security rules) is restated here so this file stands alone. Owner decisions are **[decided]**; open facts are **[unverified]** and block the step that depends on them.

Evidence: `docs/spikes/spike-u9/` (xAI ↔ MCP), `docs/spikes/spike-vercel/`, `docs/spikes/spike-cf/` (Python Workers: rejected), `docs/spikes/spike-cf-ts/` (TypeScript Workers: passed), `docs/spikes/spike-x-oauth/` (U1, U4), `docs/spikes/reviews/feasibility-r*/` (reviews; `-r5/` holds the rev-5 probes: D1 batch, async mutex, test plugin, twitter-text).

## 0. What and why

Grok bots (one per personality) research X, write scripts in their personality's voice, and call the **GrokChat MCP server** to post them on that personality's X account. GrokChat is the only component that touches X. A dashboard shows the backlog, the calendar, metrics, costs and the controls. GrokChat generates no content.

Owner decisions:

- **[decided]** Official X API v2 only.
- **[decided]** n accounts, one personality each (1:1 in v0, modelled so it can become 1:n).
- **[decided]** **Posting only:** create (single post or thread), schedule, publish now, edit/cancel before publishing, delete our own post, read metrics. No replies to others, likes, reposts, quotes, follows, DMs.
- **[decided]** Auto-publish by default; a per-account policy can switch an account to `review`.
- **[decided]** Every account's bio says MuseChat runs it and carries X's "automated" label; publishing is refused until both are confirmed on the dashboard.
- **[decided 2026-10-27]** **Cloudflare only, free plan:** Workers + D1 + Durable Objects + Cron Triggers + R2 (enabled; free allowance guarded, §3.5). No Vercel, no Supabase, nothing in MuseChat's database. Proof: `docs/spikes/spike-cf-ts/RESULTS.md`.
- **[decided 2026-10-27]** **TypeScript (strict)**, a deliberate exception to the team's Python standard (Agents/CLAUDE.md §7.2), because Python Workers fail the free plan (`1102` on the first MCP request, `docs/spikes/spike-cf/`). Recorded in a decision record in PR 1. Clean Architecture + SOLID (Agents/CLAUDE.md §7.1) apply in full, with TypeScript equivalents of every gate (§5).
- **[decided]** Secrets: Worker secrets (`wrangler secret put`); locally a gitignored `.dev.vars`. Infisical later.

Out of scope for v0: video; quote/reply/like/repost/follow; multiple personalities per account; Premium long posts (280 weighted characters for every account); any LLM inside GrokChat; a custom domain (the `workers.dev` URL is used; a domain needs a Cloudflare zone).

## 1. Facts

### 1.1 Verified (source or probe)

X API:

| Fact | Proof |
|---|---|
| `POST /2/tweets` (OAuth 2.0 user token; `text`, `media.media_ids`, `reply.in_reply_to_tweet_id`, `made_with_ai`; 201 → `data.id`); up to **4 photos or 1 GIF or 1 video**; quote posts need Enterprise | docs.x.com create-post |
| Live: three posts (plain, `https://` URL, bare domain) → 201 each; `DELETE /2/tweets/:id` → 200 `{"deleted": true}`; `x-rate-limit-limit: 100` per user per 15 min | `docs/spikes/spike-x-oauth/u4_results.json` |
| Media: simple `POST /2/media/upload` for images; GIFs chunked (`initialize/append/finalize` + status); `media.write`; images ≤ 5 MB, GIFs ≤ 15 MB; media ids expire | docs.x.com media |
| Rate limits: `POST /2/tweets` 100/15 min per user, 10,000/24 h per app; `DELETE` 50/15 min per user; `GET /2/tweets` 5,000/15 min per user; `GET /2/users/:id/tweets` 900/15 min per user | docs.x.com rate-limits |
| Pricing: create $0.015; create with URL $0.200; delete $0.010; read $0.005/resource; owned read $0.001 **only for the app owner's account**; 24 h UTC dedup; no media row | docs.x.com pricing |
| Metrics: `public_metrics`, `non_public_metrics` (user context, posts < 30 days) | docs.x.com metrics |
| Counting: 280 weighted, NFC, emoji/CJK = 2, URL = 23; twitter-text detects bare domains | docs.x.com counting-characters |
| **OAuth (U1, proved):** confidential client, HTTP Basic at `POST https://api.x.com/2/oauth2/token`; authorize at `https://x.com/i/oauth2/authorize`; PKCE S256; scopes `tweet.read tweet.write users.read media.write offline.access`; access token 2 h; **refresh tokens rotate and are single-use** (replay → 400 `invalid_request` "Value passed for the token was invalid."; the replay does not revoke newer tokens); a `http://127.0.0.1` callback is accepted; connecting needs no credits | `docs/spikes/spike-x-oauth/RESULTS.md` |

xAI remote MCP (U9, proved):

| Fact | Proof |
|---|---|
| `tools=[{"type":"mcp","server_url","server_label","authorization","allowed_tools"}]`; `authorization` bare or `Bearer …` both arrive as `Bearer …`; **no redirects followed**; each listing and call is a fresh `initialize → initialized → request` (protocol `2025-11-25`, client `rmcp`); `allowed_tools` filtered client-side; tool names shown as `grokchat___<tool>`; a wrong token fails the whole Grok request (HTTP 400); **resources never read**; **hard 60 s tool timeout**, and our handler keeps running after it | `docs/spikes/spike-u9/RESULTS.md` |

Cloudflare (spike on the owner's free account, `docs/spikes/spike-cf-ts/RESULTS.md`, and docs):

| Fact | Proof |
|---|---|
| `@modelcontextprotocol/sdk` 1.32.2 `WebStandardStreamableHTTPServerTransport` (stateless, `enableJsonResponse`) works on Workers; `/mcp` and `/mcp/` both served; Grok → Worker 2.2–3.0 s, including D1 and Durable Object tools | spike |
| Startup 45 ms; bundle 242 KB gzipped | spike |
| **CPU on the free plan:** MCP requests p50 6–7 ms, p90 13–16 ms, max 35–38 ms (cold); 13 of 54 over the nominal 10 ms; **all `ok`, no `1102`**. D1 p50 ≈ 2 ms; DO calls 1 ms; cron 1–2 ms | `wrangler tail` |
| D1: 20 concurrent conditional `UPDATE … RETURNING` claimers over 50 rows → each claimed once, **with or without the outer guard** (D1 executes each statement atomically, one writer) | spike `concurrency.py` |
| **A Durable Object does not serialise across `await`:** cap 3, 10 concurrent publishes with an outbound `fetch` between check and write → naive **5 sent**; inside `blockConcurrencyWhile` exactly 3 | spike |
| `blockConcurrencyWhile`: **30 s timeout, then the object is reset**; a throw also resets | developers.cloudflare.com durable-objects/api/state |
| Cron Triggers: `* * * * *` fires every minute (≈ 5.5 min propagation after deploy); `scheduled()` writes to D1 | spike |
| WebCrypto: AES-GCM round trip; `crypto.subtle.timingSafeEqual` available | spike |
| Workers Free: 100k requests/day; 10 ms CPU nominal per invocation; no wall-time limit for HTTP, 15 min for cron; subrequests: see the row below (50 external + 1,000 to Cloudflare services); 128 MB memory; 5 cron triggers; 64 MiB script | developers.cloudflare.com workers/platform/limits |
| Durable Objects Free: SQLite-backed only; 100k requests/day; 13,000 GB-s/day; 5M rows read/day; 100k rows written/day; 5 GB | durable-objects/platform/pricing |
| D1 Free: 10 databases, 500 MB each, 5 GB per account, 30 s per query (the documented 50 queries per invocation is not what deployed Free enforces: U16) | d1/platform/limits; spike 2 |
| Workers Paid ($5/month) fallback: 30 s CPU default, 10M requests/month | workers/platform/pricing |
| Tooling (round 5, `docs/spikes/reviews/feasibility-r5/u20-plugin/`): **`@cloudflare/vitest-plugin` 1.4.8** (MIT; the renamed successor of the deprecated `vitest-pool-workers`, which fails with vitest 5) + vitest 5.0.5 passes 13/13 tests with real local D1 and DO bindings and istanbul coverage; Stryker 10.1.1 killed 5/5 mutants on a pure module. Also: @vitest/coverage-istanbul 5.0.5, dependency-cruiser 18.7.0, @stryker-mutator/core + vitest-runner 10.1.1 (Apache-2.0), fast-check 4.10.2, hono 4.13.14, eslint 10.13.0, typescript-eslint 8.72.1, prettier 3.9.10, license-checker-rseidelsohn 5.0.1 (BSD-3), htmx.org 2.0.11 (0BSD), zod 4.6.7, wrangler 4.153.0, @cloudflare/workers-types 5.20261027.1 | `npm view`, 2026-10-27 |
| **D1 `batch()`** commits sequentially and rolls back entirely if a statement fails (a duplicate-key third insert left 0 rows; later statements see earlier writes); a batch counts as **one** query against the 50 limit. **But a guarded `UPDATE` matching 0 rows is not a failure:** a batch "stale version guard + part → SENDING" committed the SENDING write. | `docs/spikes/reviews/feasibility-r5/u20-plugin/`, d1/worker-api/d1-database, d1/platform/limits |
| **Async mutex in a DO:** cap 3, 10 concurrent calls with a slow step (fetch or timer; DO SQLite or D1): naive **10 sent** in all four variants; promise-chain mutex **exactly 3** in all four | `docs/spikes/reviews/feasibility-r5/u20-plugin/test/` |
| `twitter-text` 3.1.0 (2020-03-31; LICENSE file Apache-2.0, **no `license` field** in package.json; pulls `core-js@2` and `twemoji-parser`) passes the upstream conformance YAML: v3 counter 22/22, v2 20/20, directional 2/2, URL extraction 91/91, with indices 10/10; detects bare domains and new gTLDs; runs in workerd | `docs/spikes/reviews/feasibility-r5/u13/` |
| Workers Free subrequests (deployed, U16): **50 external** per invocation; **1,000 Cloudflare-service** calls per invocation shared by D1 queries and DO calls; each DO invocation has its own budgets | `docs/spikes/spike-2/RESULTS.md` |
| DO SQLite: key+value ≤ 2 MB; string/BLOB/row ≤ 2 MB; statement ≤ 100 KB; ≤ 100 bound parameters | durable-objects/platform/limits |
| Local workerd `fetch` reaches `127.0.0.1` and `localhost` (production behaviour undocumented), so the SSRF guard is code, tested as code | `docs/spikes/reviews/feasibility-r5/` |

### 1.2 Still unverified (each has its proof step)

- U4 **Proved (2026-10-27, owner's Usage page):** of three test posts (plain, `https://trymusechat.com`, bare `trymusechat.com`), X billed **1 ContentCreateWithUrl and 2 PostCreate**: only a scheme URL is priced as "with URL" ($0.20); a bare domain is an ordinary post ($0.015). `estimateCost` prices scheme URLs at $0.20 and bare domains at $0.015; `link_policy` governs scheme URLs. Still to confirm in the PR 4 live smoke: whether X makes the bare domain clickable (one read of the post's `entities.urls`).
- U14 **Proved (2026-10-27, `docs/spikes/spike-x-oauth/u14_results.json`):** refreshing with a revoked refresh token returns the same 400 `invalid_request` "Value passed for the token was invalid." as a stale one, so the two cannot be told apart; revoking the refresh token also invalidates its access token at once (200 → 401 on `/2/users/me`). Disconnecting needs one revoke.
- U16 **Proved (deployed, `docs/spikes/spike-2/RESULTS.md`):** a DO call costs the caller **1 of its 1,000 Cloudflare-service subrequests**, a pool shared with D1 queries (#1001 fails "Too many API requests by single Worker invocation"); it does not count against the **50 external** fetches (#51 fails "Too many subrequests"). Each DO invocation has its own 50 external and its own 1,000 pool. The documented "50 D1 queries per invocation" is not what deployed Free enforces. Fan-out to 45 / 200 / 500 DOs × (10 D1 + 5 fetches) ran clean (500: 15.3 s wall, 201 ms Worker CPU).
- U17 **Resolved (2026-10-27, owner):** R2 is enabled on the account; free allowance 10 GB storage, 1M Class A and 10M Class B operations per month. GrokChat stays inside it with the R2 quota guard (§3.5). The DO-chunk fallback is dropped.
- U18 **Proved (deployed):** from a Worker and from a DO, `127.0.0.1`, `localhost`, `10.0.0.1`, `192.168.1.1`, `169.254.169.254` and `[::1]` all return HTTP 403 `error code: 1003` from Cloudflare in ~1 ms; nothing is reached. The code guard stays (local workerd does reach loopback) and a 403/1003 is treated as a refusal.
- U19 **Partly proved (deployed):** no 1101/1102 across 1,556 requests, including Worker invocations at 373–797 ms CPU on Free, so the 10 ms nominal is not enforced per request in short runs; twitter-text costs ~36 ms on a cold isolate and 1–3 ms warm; **PBKDF2-SHA-256 above 100,000 iterations is not supported** (`NotSupportedError`), 100,000 costs 31–35 ms. Still open: sustained behaviour over a day of production traffic (E11); fallback Workers Paid.
- U15 **Proved on deployed D1** too: a UNIQUE violation rolls the batch back (0 rows); the raising `version_guard` batch rolls back on a stale version or wrong lifecycle and commits on the current one.

## 2. Costs

- **Cloudflare: $0** at our load: ≈ 1,440 cron ticks/day × 3 crons + MCP (≈ 100 posts × 3 requests + reads) + dashboard ≪ 100k requests/day; D1 and DO well inside their quotas.
- X (10 accounts × 10 posts/day ≈ 3,000 posts/month): no link $45/month; a scheme URL (`https://…`) in every post $600/month, while a bare domain (`trymusechat.com`) is billed as a plain post (U4), so writing the domain bare costs the same as no link (`link_policy` governs scheme URLs; per-create estimate). Metrics ≈ $68/month (6 decaying reads, same-day dedup). Delete $0.010 each. Media upload: no price row (`unknown`).
- Every X call writes a cost entry; the dashboard shows totals. Owner action: an X spending limit.

## 3. Architecture

Same four layers as Asterion, in TypeScript. One npm package, `src/`:

```text
src/frameworks/         Workers entry, Durable Object class, D1 repositories, media store,
                        X HTTP drivers (fetch), MCP SDK server + tool shims, Hono routes + views,
                        WebCrypto token vault, clock, ids, env parsing
src/interface_adapters/ controllers (plain values in), presenters, view models, boundary schemas (zod)
src/use_cases/          one folder per use case + ports/ + run services
src/entities/           readonly types + pure functions (no I/O)
src/main.ts             composition root: `export default { fetch, scheduled }` and the DO class
```

- **Dependency rule** enforced by dependency-cruiser: layers point inward; vendor packages (`@modelcontextprotocol/sdk`, `hono`, `cloudflare:workers`) only under `frameworks/`; `zod` only in `interface_adapters/schemas` and `frameworks/`. The build fails on a violation.
- **Framework-free controllers:** MCP tool shims and Hono routes (frameworks) turn requests into plain values and an entity `Actor`, then call controllers.
- **Entities are immutable** (`readonly`, no mutation) and pure; zod only at boundaries.
- Routes: `/mcp` and `/mcp/` (bots), `/dashboard/*` and `/oauth/x/*` (admin session), `/health`. Cron Triggers call `scheduled()` directly (no HTTP route, so no cron secret).

### 3.1 Entities (`src/entities/`)

- Identity: `AccountId`, `PersonalityId`, `PostId`, `BotId`, `XUserId`, `XPostId`, `IdempotencyKey` (branded strings); `BotScope(botId, accountIds)`; `Actor = Bot | Human | System`; `authorize(actor, accountId) → Allowed | Refused("scope")`, called by every interactor after loading the resource.
- Content: `Personality(id, name, voiceGuide, topics, dos, donts, examples, version)`; `StagedMedia(id, ownerAccountId, kind: PHOTO|GIF, contentType, size, storageKey, sha256)`; `PostPart(index, text, media)`; `validatePart` (280 weighted chars; ≤ 4 photos or 1 GIF); `containsUrl` (U13).
- Accounts: `Account(id, xUserId, handle, personalityId, status: ACTIVE|PAUSED|DISCONNECTED|NEEDS_RECONNECT, disclosure(bioConfirmed, automatedLabelConfirmed), policy, isAppOwner)`; `PostingPolicy(mode: AUTO|REVIEW, dailyCap, minGap, quietHours?, tz, linkPolicy, grace)`.
- `checkPublishable(account, post, now, recent) → Allowed | Refused(reason)`: ACTIVE (so PAUSED, DISCONNECTED and NEEDS_RECONNECT refuse), disclosure, link policy, quiet hours, cap and min-gap over every post with a part SENDING, SENT or UNKNOWN in the account's tz day.
- Posts: `PartState = PENDING | SENDING(attemptAt) | SENT(xPostId) | UNKNOWN(attemptAt) | NOT_FOUND | REJECTED(reason) | DELETED`; `Post(id, accountId, parts, lifecycle, publishAt, resumeAt?, idempotencyKey, requestHash, createdBy, provenance(botId?, personalityVersion, policySnapshot), version)`; `Lifecycle = DRAFT | PENDING_REVIEW | SCHEDULED | RESUMING | PUBLISHING | DONE | CANCELLED | MISSED`; `derivedStatus`; `transition(post, event) → Post | Refused` (§3.1.1); `mapXOutcome(error) → PartEvent` (a 401/403 auth error from `create` means the token was revoked: account → NEEDS_RECONNECT and the post goes back as a gate refusal, never REJECTED/FAILED); `missed(post, now)` measured from max(`publishAt`, the not-before time a part-1 deferral or retry set), so a post held back by the gate or by X's `retryAt` is never missed for waiting, and `publishAt` itself never moves; `metricsDue`; `estimateCost`; `redact`.
- `refreshOutcome(result) → Rotated | RetryableBeforeSend | Lost` (U1/U14). Refresh tokens are single-use and X returns the same 400 `invalid_request` for stale and revoked tokens (U14), so anything other than a success or a failure **before** the request left (connect error) is `Lost` — but only after the DO, under `Locks.token`, confirms the stored refresh token is still the one it sent (if it changed, retry once with the stored one; U1 showed a stale replay does not revoke newer tokens). Then: the account goes to **`NEEDS_RECONNECT`** (publishing refused, shown on the dashboard, cleared only by reconnecting) and the old token is never retried (A2).

#### 3.1.1 Transition table (exhaustive-test spec; any pair not listed is Refused)

Rev 4's lease rows are replaced by **ownership by the account's Durable Object** (§3.5). Every publish call takes the account's `publishLock` and first runs recovery; while that lock is held, no other publish step for the account is running, so **every PUBLISHING post found at that moment is dead by construction** (A3). No in-flight set or lease is needed.

| From | Event | To |
|---|---|---|
| DRAFT | submit (AUTO) | SCHEDULED (publishAt = given or now) |
| DRAFT | submit (REVIEW) | PENDING_REVIEW |
| DRAFT, PENDING_REVIEW, SCHEDULED (all parts PENDING) | edit | same (version+1) |
| DRAFT, PENDING_REVIEW, SCHEDULED (all parts PENDING) | cancel | CANCELLED |
| PENDING_REVIEW | approve | SCHEDULED (past publishAt → now) |
| PENDING_REVIEW | reject | CANCELLED |
| SCHEDULED | DO starts it (now ≥ max(publishAt, resumeAt), not missed) | PUBLISHING (version+1; resumeAt cleared) |
| RESUMING | DO starts it (now ≥ resumeAt) | PUBLISHING (version+1) |
| SCHEDULED (all parts PENDING) | missed (now > max(publishAt, resumeAt) + grace) | MISSED |
| PUBLISHING | ReservePart k Allowed | part k SENDING (D1 write awaited **before** the X call) |
| PUBLISHING | ReservePart k Refused (paused, undisclosed, cap, gap, quiet hours) | k = 1: SCHEDULED, not before the next allowed time (resumeAt = next allowed; publishAt kept); k > 1: RESUMING (resumeAt = next allowed) |
| PUBLISHING | part k sent(xId) | part SENT; last part → DONE (PUBLISHED) |
| PUBLISHING | part k unknown | part UNKNOWN; DONE (UNKNOWN_OUTCOME) |
| PUBLISHING | part k rejected | k = 1: DONE (FAILED); k > 1: DONE (PARTIALLY_PUBLISHED) |
| PUBLISHING | part k retryable or 429(user) | part PENDING; k = 1: SCHEDULED, not before resumeAt; k > 1: RESUMING (resumeAt = retryAt or now + 1 min) |
| PUBLISHING | 429(app) | as retryable; the tick stops dispatching |
| PUBLISHING | VersionConflict on any step | stop this post, send nothing more; the next publish call's recovery resolves it |
| PUBLISHING | token `NeedsReconnect` (obtained **before** ReservePart, so no part is SENDING) | account → NEEDS_RECONNECT; k = 1: SCHEDULED; k > 1: RESUMING (as a gate refusal) |
| PUBLISHING | a needed refresh does not fit the remaining deadline | yield (as the budget-yield row), before calling X |
| SCHEDULED | `publishNow` could not get `publishLock` before its deadline | unchanged; the MCP call returns the derived status (the tick publishes it) |
| PUBLISHING | worker yields (budget) | nothing SENT → SCHEDULED (resumeAt = now); some SENT → RESUMING (resumeAt = now) |
| PUBLISHING (found under `publishLock`), no part SENDING, none SENT | recover | SCHEDULED (resumeAt = now, version+1) |
| PUBLISHING (found under `publishLock`), no part SENDING, some SENT | recover | RESUMING (resumeAt = now) |
| PUBLISHING (found under `publishLock`), a part SENDING | recover | that part UNKNOWN; DONE (UNKNOWN_OUTCOME); never re-sent |
| (part) UNKNOWN | reconcile found | part SENT; later parts PENDING → RESUMING; else DONE (PUBLISHED) |
| (part) UNKNOWN | reconcile not found ×2 | NOT_FOUND |
| NOT_FOUND | human "re-send, I checked X" | that part PENDING; k = 1: SCHEDULED (now); k > 1: RESUMING; audited |
| FAILED | human re-schedule | SCHEDULED (parts PENDING) |
| MISSED | human re-schedule | SCHEDULED |
| RESUMING | cancel | DONE (PARTIALLY_PUBLISHED) |
| RESUMING, PUBLISHING, DONE | edit | Refused |
| PUBLISHED / PARTIALLY_PUBLISHED | delete | each SENT part → DELETED, last first; a failed delete leaves it SENT ("delete incomplete") |

### 3.2 Ports (`src/use_cases/ports/`, entity types only)

| Port | Methods |
|---|---|
| `PostReader` | `get(id)`, `findByIdempotency(botId, key)`, `list(filter)`, `accountsNeedingWork(now)` (accounts with a post due, a post PUBLISHING, a part UNKNOWN, or metrics due; indexed, A3) |
| `PostWriter` | `add(post) → Added | Duplicate(existing)` (unique `(bot_id, idempotency_key)`), `save(post, expectedVersion, expectedLifecycle) → Ok | VersionConflict`, `commitPart(post, k, change, audit, cost) → Ok | VersionConflict` (one guarded D1 batch: version guard first, then the part, post, audit and cost writes, so a part costs a fixed number of queries; M2-feas, A4) |
| `AccountRepository`, `PersonalityRepository`, `MediaRepository` | get / list / save |
| `MediaBlobStore` | `put(bytes, contentType) → key`, `get(key)` (R2, U17) |
| `MediaFetcher` | `fetch(httpsUrl, maxBytes, allowedTypes) → bytes` (SSRF guard in the driver, U18) |
| `AccountPublisher` | `publishDue(accountId, now, budget) → Summary`, `publishNow(accountId, postId, deadline) → Summary` (port to the account's DO) |
| `AccountReconciler` | `reconcile(accountId, now, budget)` |
| `AccountMetricsCollector` | `collect(accountId, now, budget)` |
| `AccountXGateway` | `deletePost(accountId, xPostIds)`, `storeConnectedTokens(accountId, tokenSet)` — every X call and every token write goes through the account's DO; tokens never leave it (A1) |
| `Locks` | `publish.run(fn, deadline?)` and `token.run(fn)` — two non-reentrant async mutexes inside the account's DO, always taken in the order publish → token; `token` covers only load → refresh → persist (A1) |
| `TokenProvider` | `accessToken(accountId) → AccessToken | NeedsReconnect` — under `Locks.token`; refreshes proactively when < 10 min remain; writes a `REFRESHING(attemptAt)` marker to DO storage before calling X, and clears the marker and stores the rotated token in **one atomic DO storage `put`** before returning; a marker found on entry means a refresh was interrupted → `NeedsReconnect` (A2) |
| `Budget` | a value `(deadline, cloudflareCalls ≤ 1,000 shared by D1 and DO calls, externalSubrequests ≤ 50)`; port decorators decrement it; a part reserves its worst case (media + create + commit) before starting and yields if it does not fit; the token step runs earlier and budgets its own refresh (A4, N1) |
| `MetricsRepository`, `AuditLog`, `CostLedger`, `OAuthStateStore`, `LoginThrottle` | as rev 4 |
| `XPublisher`, `XMediaUploader`, `XMetricsReader`, `XOwnTimelineReader`, `XAccountConnector` | as rev 4 (take `accountId`, never tokens) |
| `Clock`, `IdGenerator` | as rev 4 |

### 3.3 Use cases (every input carries `actor`; every interactor authorises against the loaded resource)

1. `createPost` (single or thread): idempotency key required for bots (`Duplicate` with a matching `requestHash` → existing post; mismatch → `idempotency_mismatch`); validates parts, media ownership, link policy, offset-aware `publishAt`; submits per §3.1.1; AUTO and due → `AccountPublisher.publishNow` with a **10 s budget** (well inside xAI's 60 s); the deadline also covers waiting for `publishLock`; on exhaustion it returns the derived status and the next tick finishes (m1/m5).
2. `editPost`, `cancelPost`, `approvePost`, `rejectPost`, `reschedulePost`.
3. `stageMediaFromUrl` (bot, ≤ 20 s) and `stageMediaUpload` (dashboard; direct POST ≤ 4 MB; magic-byte check).
4. Run service `PublishPost`, executed inside the account's DO under `Locks.publish`: first **recovery** (§3.1.1); then for each PENDING part, in this order (N1, round 6): (1) **token first** — `TokenProvider.accessToken` under `Locks.token`; if a refresh is needed and its worst case does not fit the remaining deadline, yield before refreshing (rare: tokens refresh when < 10 min remain); `NeedsReconnect` writes the account's `NEEDS_RECONNECT` status to D1 and the post goes back as a gate refusal, **with no part marked SENDING**; (2) reserve the part's worst-case `Budget` (media + create + commit; no refresh in it) or yield; (3) **ReservePart** = load the account and recent activity from D1 → `checkPublishable` → guarded batch writing part SENDING (awaited); (4) `XPublisher.create`, outside any D1 transaction; (5) `commitPart` (SENT + audit + cost in one guarded batch). Errors go through `mapXOutcome`; a VersionConflict stops the post. `MediaStager` uploads media just before its part.
5. `publishDueTick` (cron `* * * * *`): one indexed D1 query for `accountsNeedingWork(now)`, then `AccountPublisher.publishDue` for **at most 200 accounts per invocation** (U16: each costs the tick 1 Cloudflare-service call; 500 ran clean; the ceiling is asserted, oldest due first, the rest wait one minute); an app-scope 429 stops dispatch. Recovery runs inside each publish call (A3).
6. `reconcileTick` (cron `*/10`): per account, single-flight inside the DO (m2), UNKNOWN parts → `XOwnTimelineReader.recent(since = attemptAt − 60 s, 5)` with a normalised text match (+ `in_reply_to` for thread parts). X's v2 `text` rewrites every URL, bare domains included, to a t.co link and appends one for media, so the match is URL-insensitive: both sides are unescaped and NFC-normalised, every URL becomes one mark, and trailing marks are dropped (`normalisePostText`).
7. `deletePost` (through `AccountXGateway`).
8. `metricsTick` (cron `*/15`): per account, single-flight inside the DO (m2), posts where `metricsDue`, ≤ 100 ids per call.
9. Read side: `getPost`, `listBacklog`, `getCalendar`, `getPostMetrics`, `getAccountMetrics`, `comparePosts`, `getPersonality`, `getPolicy`, `costTotals`, `auditList`.
10. Admin: `savePersonality`, `setPolicy`, `setAccountStatus` (kill switch), `confirmDisclosure`, `connectAccountBegin` / `connectAccountComplete` (PKCE + state bound to the admin session; tokens stored through `AccountXGateway`; reconnect refuses a different `xUserId` and clears `NEEDS_RECONNECT`; new accounts start PAUSED).

Cost and audit are decorators on the X ports (frameworks), not inside interactors.

### 3.4 Interface adapters

- MCP controllers, one per tool: `create_post`, `create_thread`, `stage_media_from_url`, `edit_post`, `cancel_post`, `delete_post`, `get_post`, `list_backlog`, `get_post_metrics`, `get_account_metrics`, `compare_posts`, `get_personality`, `get_policy`. Account-addressed tools take `account_id`; post-addressed tools only `post_id`. **No MCP resources.** Refusals are tool results with `isError: true` and a code.
- Presenters: structured outputs; every string through `redact`.
- Dashboard controllers and view models: backlog, calendar, post detail, accounts (connect, disclosure, policy, kill switch), personalities, metrics, costs, audit.
- Schemas: zod at the MCP and HTTP boundaries only.

### 3.5 Frameworks & drivers

- **Worker entry** (`main.ts`): `fetch` routes through Hono; `scheduled` dispatches by `controller.cron`.
- **MCP:** per request, a new `McpServer` + `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` (measured p50 6–7 ms CPU); tools registered from a static table; `/mcp` and `/mcp/` both served, never redirected.
- **Bot auth:** secret `GROKCHAT_BOT_CLIENTS` = JSON `[{id, tokenSha256, accounts}]`; tokens ≥ 32 random bytes; the SHA-256 of the presented token compared with every entry using `crypto.subtle.timingSafeEqual`, no early exit; unknown account ids fail closed.
- **`AccountPublisher` Durable Object** (one per account, `idFromName(accountId)`): hosts the publish, recovery, reconcile, metrics, delete and token code for its account. Two **promise-chain mutexes** (`publish`, `token`, always in that order; proved to serialise across `await`, `docs/spikes/reviews/feasibility-r5`) — not `blockConcurrencyWhile`, whose 30 s reset is too short for an X call plus D1 writes. Its SQLite storage holds the account's **encrypted token set** and the `REFRESHING` marker. Every method catches and maps errors (an uncaught throw resets the object). The token call has no short abort (≥ 60 s), because cutting it off after X rotated loses the token. The use-case graph inside the DO is built by the same factory in `main.ts` as the Worker's (m6).
- **D1 (`grokchat`):** posts, parts, accounts, personalities, staged-media metadata, metrics, audit, cost, OAuth state, login throttle. Single-statement changes: `UPDATE … WHERE id = ? AND version = ? AND lifecycle = ?` (0 rows → VersionConflict). **Multi-statement changes: a batch whose first statement is a raising guard** — `INSERT INTO version_guard(ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND version = ?2 AND lifecycle = ?3) THEN 1 ELSE NULL END` against `version_guard(ok INTEGER NOT NULL)`, ending with `DELETE FROM version_guard`; a stale version fails with `NOT NULL constraint failed` and the whole batch rolls back (tested, `docs/spikes/reviews/feasibility-r5`); the driver maps that to VersionConflict. Unique `(bot_id, idempotency_key)`. Indexes `(lifecycle, publish_at)`, `(account_id, lifecycle)`, `(account_id, published_at)` so the per-minute queries never scan (5M rows read/day). Read replication (Sessions API) off: reads before a SENDING write must see the primary. Migrations with `wrangler d1 migrations apply` (own database, no deploy windows). Query and subrequest use is bounded per part through `Budget` (A4); tests assert each part's worst case and `meta.rows_read`.
- **Media:** private R2 bucket `grokchat-media`. **Quota guard (owner: never exceed the free tier):** D1 tracks stored bytes and this month's Class A (writes, lists) and Class B (reads) operations; uploads are refused with `media_quota` once stored bytes would pass **8 GB** or Class A passes **800k** for the month, and reads stop at **8M** Class B; staged media is deleted 7 days after its post publishes or 2 days after it was staged and never used (cleanup in the metrics tick); the dashboard shows usage against the 10 GB / 1M / 10M allowance. `stage_media_from_url`: https only, a host allowlist, `redirect: "manual"` with every hop re-checked against the allowlist, literal-IP hosts refused, size caps, magic bytes (Workers cannot resolve DNS, so the allowlist is the guard; U18).
- **X drivers:** `fetch` with `AbortSignal.timeout` (≤ 20 s); a failure before the request is sent → `XRetryable`; a timeout or 5xx after sending → `XOutcomeUnknown`; 429 with `x-rate-limit-*` → `XRateLimited(scope)`; refresh errors through `refreshOutcome`.
  - As built (PR 4, `src/frameworks/x_http`, `src/frameworks/x_auth`): a 403 is split by its body — X's auth problems (`unsupported-authentication`, `client-forbidden`, any unrecognised 403) → needs reconnect; a content refusal (`about:blank` "Forbidden" with "duplicate content", "not allowed to create/post", "not permitted to perform") → `content_refused` → rejected. A 429's scope is the app's when `x-app-limit-24hour-remaining` is 0, else the user's (24-hour, then 15-minute window). **workerd reports a refused connection as "Network connection lost.", the same as a dropped one** (measured in the contract suite), so only errors that name a pre-send cause (DNS, TLS, the subrequest limit) are retryable; everything else is unknown, never re-sent. The timeline port returns the oldest `maxResults` posts at or after `since`, oldest first, read as one page bounded by a 10-minute window. Cost and audit for create, delete, uploads and reads stay in the run services through `XCallRecorder` (the create's pair must go into `commitPart`'s batch, A4); decorators cover the two OAuth calls, which no run service records.
- **Token vault:** AES-GCM with keys from secret `GROKCHAT_TOKEN_KEYS` (comma-separated, newest first; ciphertext carries the key id).
- **Dashboard:** Hono, server-rendered HTML, vendored htmx (SHA-384 pinned). Session: signed cookie (HMAC-SHA-256, `SameSite=Strict; Secure; HttpOnly`, 12 h). Every Worker on the same `workers.dev` subdomain is same-site, so SameSite is not the fence: a CSRF token per session **and** an exact Origin check on every non-GET route are (m4); admin password hash PBKDF2-SHA-256 via WebCrypto at **100,000 iterations**, the Workers maximum (U19; ~33 ms CPU per login, accepted: login is rare and behind the throttle; below OWASP's 600k for SHA-256, recorded as an accepted constraint); `LoginThrottle` in D1.
- **OAuth connect:** `/oauth/x/start` and `/oauth/x/callback` behind the admin session; the Worker's callback URL is added to the X app.
- **Worker → DO calls:** a rejected DO call (the object was reset or aborted mid-call) maps to "outcome unknown; recovered by the next publish call", **never** to a retry of the publish from the Worker side.
- **Logging:** our own logs never include `Authorization`, `Cookie`, or the callback's `code`/`state`; a test inspects captured logs (m3).

### 3.6 Deployment

- One Worker `grokchat` on the owner's free Cloudflare account. The owner renames the account's `workers.dev` subdomain from `grokchat-spike-ts` first.
- `wrangler.jsonc`: D1 binding `DB` (`grokchat`), DO binding `ACCOUNT` (`AccountPublisher`, `new_sqlite_classes`), R2 binding `MEDIA` (`grokchat-media`), crons `* * * * *`, `*/10 * * * *`, `*/15 * * * *`, observability on.
- Secrets: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `GROKCHAT_BOT_CLIENTS`, `GROKCHAT_TOKEN_KEYS`, `GROKCHAT_SESSION_SECRET`, `GROKCHAT_ADMIN_PASSWORD_HASH`. Vars: `GROKCHAT_PUBLIC_ORIGIN`, `GROKCHAT_MEDIA_HOSTS`.
- Deploys by hand (`wrangler deploy`) from a release on `main`; no Git integration. A deploy resets every DO (in-flight sends become UNKNOWN, then reconcile): deploy when `/health` reports no PUBLISHING posts (m7). Cron triggers are capped at 5 per account; GrokChat uses 3.
- Bots: `server_url = https://grokchat.<subdomain>.workers.dev/mcp`, `authorization = <bot token>`. Runbook: test each bot's token with one `get_policy` call (a wrong token fails the whole Grok request).

## 4. Risks and proofs

- R1 Double send. One DO per account + async mutex + SENDING written before the X call + version-guarded D1 writes + recovery rows. Proof (`@cloudflare/vitest-plugin`, real local DO + D1): 10 concurrent `publishNow` for one account with cap 3 → exactly 3 sends; **negative control** with the mutex disabled → more than 3 (the spike saw 5). A stale write after recovery → VersionConflict, no send.
- R2 Unknown outcome → reconcile, never re-sent (publisher stub raising `XOutcomeUnknown`).
- R3 Token refresh race: 5 concurrent `accessToken()` calls with an expired token → exactly one refresh, every caller gets the rotated token, which is persisted before return; control without the mutex → several refreshes and a stale-token failure (the X stub models U1's single-use tokens).
- R4 Crash between X's 201 and our write: the stubbed `create` first asserts that part k is already SENDING in D1 (so a regression that delays the SENDING write fails the test); then the store fails; recovery → UNKNOWN; reconcile finds it; never re-sent. A DO reset mid-publish → recovery on the next call.
- R5 CPU budget (U19): `wrangler tail` CPU per route after deploy; MCP handler kept lean; fallback Workers Paid.
- R6 xAI ↔ MCP: proved (U9); a regression test pins `/mcp` without redirect and stateless JSON.
- R7 Cross-account: I2 over every tool × {account, post, media} id owned by another account → refused, nothing written, audited.
- R8 Secrets never in logs, audit, errors or presenter output (I6).
- R9 Link cost: `estimateCost` + `containsUrl` conformance (U13, U4).
- R10 Policy race: covered by R1 (the cap is checked under the mutex and counts SENDING).
- R11 OAuth CSRF / account swap: missing session, replayed / expired / foreign state, a different `xUserId` on reconnect.
- R12 Dashboard CSRF / brute force: POST without token → 403; wrong Origin → 403; throttle → 429.
- R13 SSRF in `stage_media_from_url` (U18).
- R14 Idempotency race: two concurrent creates with one key → one post, one X call; different content → `idempotency_mismatch`.
- R15 Budget yield: inline `publishNow` exhausts its budget after part 1 of 3 → the next tick finishes the thread.
- R16 Per-invocation limits (U16): each part's worst-case `Budget` (Cloudflare-service calls ≤ 1,000 shared by D1 and DO calls; external ≤ 50) is asserted; the tick's fan-out ceiling (200) is asserted; deployed limits measured in spike 2 (U16).
- R18 Lost token (A2, N1): the token response is lost after X rotated; the DO resets between the token call and the persist; a replayed token → `NEEDS_RECONNECT`, no further refresh calls, publishing refused; **a lost token leaves no part SENDING and causes no reconcile read**; `publishNow` with a token that needs a refresh and a deadline too short for it yields without calling X; a 401/403 from `create` → NEEDS_RECONNECT, not FAILED.
- R19 Deadlock (A1): an expired token during `publishNow` → one refresh, the post is sent (publish → token lock order).
- R20 Orphan (A3): a post left PUBLISHING on an account with nothing else due is recovered by the next tick.
- R21 Stale batch (M2-feas): a guarded batch with a stale version changes nothing and maps to VersionConflict.
- R17 DO reset by a throw: a test throws inside a part; the object recovers its post per §3.1.1.

## 5. Repo layout and tooling (TypeScript equivalents of Asterion's gates)

`package.json` + `package-lock.json` (npm, exact versions), `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `wrangler.jsonc`, `.dev.vars.example`, `migrations/` (D1 SQL).

| Asterion gate | GrokChat |
|---|---|
| import-linter layers + vendor bans | dependency-cruiser rules |
| pyright strict | `tsc --noEmit` strict (+ the flags above) |
| ruff ALL | ESLint (typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`) + Prettier |
| pytest + coverage ≥ 90% line and branch | Vitest 5 with **`@cloudflare/vitest-plugin`** for drivers and integration (workerd, real local D1 and DO; compat date pinned to one its bundled workerd supports) and plain Node Vitest for the pure layers; istanbul thresholds `lines: 90, branches: 90`, each enforced separately |
| Hypothesis | fast-check |
| mutmut | Stryker (vitest runner) on entities, use cases, interface adapters, run under **plain Node** (those layers use no Workers API once A5 holds; Stryker inside the workerd plugin is not relied on, A6); no surviving mutants |
| pip-licenses / pip-audit | license-checker-rseidelsohn (allowlist; explicit override for `twitter-text`, whose package.json has no licence field but ships an Apache-2.0 LICENSE) + `npm audit --omit=dev` |
| pre-commit hooks + gitleaks | the same pre-commit config with gitleaks + `npm run check` |
| no utils modules; ≤ 40-line functions; ≤ 400-line modules | ESLint `max-lines-per-function: 40`, `max-lines: 400`; dependency-cruiser forbids `utils|helpers|common|misc` paths |

`docs/decisions/`: the TypeScript exception; one record per runtime dependency (`@modelcontextprotocol/sdk`, `zod`, `hono`, htmx, twitter-text); hosting on Cloudflare. `docs/architecture.md`, `docs/runbook.md`, `CHANGELOG.md`, `CONTRIBUTING.md` (the one-line full local check). `.github/workflows/ci.yml` runs the same check once Actions billing is fixed (ASTERION-42); until then every PR pastes the local check output.

## 6. Tests

- `tests/architecture/`: dependency-cruiser passes; ports import only entities; no vendor types in port signatures (a compiler-API scan); entities have no I/O imports and no mutable state. **Ambient types (A5):** `entities/`, `use_cases/` and `interface_adapters/` compile in their own TypeScript project with `"types": []` and `lib: ["ES2023"]` (no DOM, no workers-types); only `frameworks/` and `main.ts` see `@cloudflare/workers-types`. A fixture that uses `D1Database` in `use_cases/` must fail `tsc`. A `/// <reference types=…>` directive would bypass that setting, so ESLint's `@typescript-eslint/triple-slash-reference` (`types`, `path`, `lib`: `never`) is an error in the inner layers, and the fixture set includes that case.
- `tests/contract/`: one suite per port, run against the in-memory stub **and** the real driver (D1 and DO through `@cloudflare/vitest-plugin`; X drivers against fetch fixtures shaped from the docs; a `live` suite for real X, never in CI).
- `tests/invariants/`: I1 each part sent at most once (R1, R4); I2 scope (R7); I3 no send for PAUSED/DISCONNECTED/undisclosed; I4 UNKNOWN never re-sent without the confirmation; I5 every X call has a cost and an audit entry; I6 no secrets anywhere; I8 idempotency under concurrency (R14); I9 per-part budgets and `meta.rows_read` (R16).
- `tests/unit/`: every interactor on stubs; §3.1.1 exhaustively; fast-check on policies (cap, gap, quiet hours across time zones and DST, `missed`, `metricsDue`, `estimateCost`) and `redact`; twitter-text conformance (U13).
- `tests/integration/`: through `main.ts` in workerd: MCP SDK client → `create_post` → `scheduled()` → published (stub X); wrong token 401; `/mcp` without redirect; dashboard login → CSRF → approve → tick.
- Coverage ≥ 90% line and branch (separate thresholds); 100% target on entities and use cases; Stryker with no survivors.

## 7. Delivery

### 7.0 Spike 2 (before PR 1; throwaway, deleted after)

Deployed (throwaway Worker on the owner's account, deleted after): U16 (fan-out and per-invocation limits), U18 (production fetch to private addresses), U15 on deployed D1, U19 cold-start CPU of twitter-text and PBKDF2. Live X: U14 (revoked-token error). Owner: U17 (R2 checkout). Already settled locally in round 5: U13, U15, U20, the async mutex. If any fails, the plan changes before PR 1.

### 7.1 PRs (one GROKCHAT ticket each; each leaves the full local check green)

1. Skeleton & tooling: package, tsconfig, ESLint/Prettier, dependency-cruiser, Vitest + `@cloudflare/vitest-plugin`, the two TypeScript projects (A5), coverage thresholds, Stryker, licence check, decision records, `main.ts` with `/health`.
2. Entities & use cases on in-memory stubs: §3.1–3.3, the transition table, twitter-text (U13), unit / property / invariant tests, Stryker.
3. D1 + DO drivers: migrations, repositories, `AccountPublisher` DO with the two mutexes, recovery under `publishLock`, the token store with the `REFRESHING` marker, the guarded-batch `commitPart`, the media store; concurrency tests with negative controls (R1, R3, R4, R14, R17, R18–R21).
4. X drivers: publisher, media (simple + chunked), metrics, own timeline, connector, token provider, cost/audit decorators; contract suites; live smoke run by the owner under a spending limit.
5. MCP server: shims, bot auth, tools, presenters; integration tests (R6, R7).
6. Cron ticks: dispatch, recovery, reconcile, metrics (R2, R15, R16).
7. Dashboard: login, CSRF, throttle, OAuth connect, backlog, calendar, post detail, accounts, personalities, metrics, costs, audit (R11, R12).
8. Deploy: D1 migrations, secrets, crons, the subdomain rename, runbook, production checks E1–E11.

## 8. Exit criteria

- E1 A Grok bot creates a post through GrokChat and it appears on X.
- E2 A post scheduled for T is published between T and T + 2 min on the deployed Worker.
- E3 A bot is refused outside its scope on every tool, by account, post or media id.
- E4 Policy holds at create and at publish, under concurrency.
- E5 No part is ever sent twice (R1, R4 with negative controls).
- E6 Token refresh is race-free and rotation-safe (R3).
- E7 Unknown outcomes are reconciled and never re-sent without a human confirmation.
- E8 The dashboard shows backlog, calendar, metrics, costs, audit; the kill switch stops an account by the next tick; CSRF and throttling hold.
- E9 Metrics are collected on the decay schedule and returned by the metrics tools.
- E10 `npm run check` clean: tsc strict, ESLint, dependency-cruiser, Vitest with ≥ 90% line and branch, Stryker no survivors in entities, use cases, interface adapters, licence check.
- E11 A day of production traffic shows no `1102`/`1101` (U19).

## 9. Follow-ups (not v0)

Video; Premium long posts; Infisical; DO alarms for exact-minute scheduling (cron is the heartbeat in v0); a custom domain; alerting (account DISCONNECTED, post NOT_FOUND, a stale-token bug).

## 10. Rev 5 changes from rev 4

Hosting (Vercel → Workers); database (Supabase/Postgres → D1); concurrency (Postgres claim SQL, account lease rows, `PublishTransactions`, leases and reaper rows → one `AccountPublisher` DO per account with an async mutex, an in-flight set and recovery rows); language (Python → TypeScript, with gate equivalents); secrets (env → Worker secrets); media (bytea → R2 or DO chunks); cron (Vercel/external → Cron Triggers calling `scheduled()` directly, no cron secret); OAuth (U1 proved: rotating, single-use refresh tokens, `refreshOutcome`); MCP (U9 proved: no resources, `/mcp` without redirect, a 60 s budget). The MuseChat fence, the service-key ban and deploy windows are gone with Supabase. Rev 1–4 findings that still apply (scope, idempotency, SENDING before send, unknown outcomes, CSRF, OAuth state, SSRF, policy counting in-flight posts, framework-free controllers, budgets) are kept as R1–R17 and I1–I9.

## 11. Round 5 findings → changes

Architecture: A1 (deadlock; tokens outside the DO) → two ordered mutexes, `AccountXGateway`, R19. A2 (lost rotation) → `NEEDS_RECONNECT`, `REFRESHING` marker, no short abort, proactive refresh, R18. A3 (orphaned PUBLISHING) → `accountsNeedingWork` includes PUBLISHING; recovery under `publishLock` makes the in-flight set unnecessary, R20. A4 (per-invocation limits) → `Budget` with worst-case reservation per part, `commitPart` batch, fan-out ceiling 40, R16. A5 (ambient types) → separate TypeScript project for the inner layers with no ambient types + fixture test. A6 (Stryker in workerd) → Stryker on the pure layers under plain Node. Minors: m1/m5 lock wait counts against the deadline; m2 single-flight reconcile/metrics; m3 log redaction; m4 Origin + CSRF, not SameSite; m5 read replication off; m6 ports split (ISP) and one factory; m7 deploy when quiet; m8 cold-start CPU in spike 2.

Feasibility: M1 (test pool deprecated) → `@cloudflare/vitest-plugin` 1.4.8. M2 (stale guard commits the batch) → raising `version_guard` first statement, R21. Minors: subrequest wording (50 external + 1,000 Cloudflare), indexes and `rows_read`, twitter-text facts and licence override, the 5-cron cap, PBKDF2 measured in spike 2. U13, U15 (local), U20 settled; U16, U18 move to the deployed spike 2.

Round 6 (architecture): N1 (token obtained after SENDING) → token step first, yield if a refresh cannot fit, `NeedsReconnect` as a gate refusal with no SENDING part, atomic marker clear + token write, R18 extended.
Round 6 (feasibility, converged; minors): triple-slash references banned in the inner layers; the stale subrequest row and R1's tool name fixed; a rejected DO call is never retried from the Worker.
Round 7 (architecture): CONVERGED. Minor folded in: a 401/403 from `create` → NEEDS_RECONNECT.

## 12. Spike 2 results → changes (2026-10-27)

U14 (revoked = stale error; access token dies with it) → `refreshOutcome` checks the stored token under `Locks.token` before `Lost`. U15 deployed → confirmed. U16 → `Budget` models the shared 1,000 Cloudflare-service pool + 50 external; fan-out ceiling 200. U18 → 403/1003 is a refusal; code guard kept. U19 → PBKDF2 capped at 100,000 (Workers maximum); cold twitter-text ~36 ms; sustained CPU still E11. U17 → R2 enabled with the quota guard. U4 → only scheme URLs are billed "with URL".
