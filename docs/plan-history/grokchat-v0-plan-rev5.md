# GrokChat v0 — implementation plan (rev 5: Cloudflare + TypeScript)

Status: **draft for review.** Rev 5 replaces the Vercel/Supabase/Python design (rev 4, converged, archived as `grokchat-v0-plan-rev4-vercel-supabase.md`) after the owner chose Cloudflare only on 2026-10-27. What carries over unchanged from rev 4 (the domain model, the state machine, the policies, the use cases, the security rules) is restated here so this file stands alone. Owner decisions are **[decided]**; open facts are **[unverified]** and block the step that depends on them.

Evidence: `.plans/spike-u9/` (xAI ↔ MCP), `.plans/spike-vercel/`, `.plans/spike-cf/` (Python Workers: rejected), `.plans/spike-cf-ts/` (TypeScript Workers: passed), `.plans/spike-x-oauth/` (U1, U4), `.plans/evidence/feasibility-r*/` (rev 1–4 reviews).

## 0. What and why

Grok bots (one per personality) research X, write scripts in their personality's voice, and call the **GrokChat MCP server** to post them on that personality's X account. GrokChat is the only component that touches X. A dashboard shows the backlog, the calendar, metrics, costs and the controls. GrokChat generates no content.

Owner decisions:

- **[decided]** Official X API v2 only.
- **[decided]** n accounts, one personality each (1:1 in v0, modelled so it can become 1:n).
- **[decided]** **Posting only:** create (single post or thread), schedule, publish now, edit/cancel before publishing, delete our own post, read metrics. No replies to others, likes, reposts, quotes, follows, DMs.
- **[decided]** Auto-publish by default; a per-account policy can switch an account to `review`.
- **[decided]** Every account's bio says MuseChat runs it and carries X's "automated" label; publishing is refused until both are confirmed on the dashboard.
- **[decided 2026-10-27]** **Cloudflare only, free plan:** Workers + D1 + Durable Objects + Cron Triggers (+ R2 if U17 allows). No Vercel, no Supabase, nothing in MuseChat's database. Proof: `.plans/spike-cf-ts/RESULTS.md`.
- **[decided 2026-10-27]** **TypeScript (strict)**, a deliberate exception to the team's Python standard (Agents/CLAUDE.md §7.2), because Python Workers fail the free plan (`1102` on the first MCP request, `.plans/spike-cf/`). Recorded in a decision record in PR 1. Clean Architecture + SOLID (Agents/CLAUDE.md §7.1) apply in full, with TypeScript equivalents of every gate (§5).
- **[decided]** Secrets: Worker secrets (`wrangler secret put`); locally a gitignored `.dev.vars`. Infisical later.

Out of scope for v0: video; quote/reply/like/repost/follow; multiple personalities per account; Premium long posts (280 weighted characters for every account); any LLM inside GrokChat; a custom domain (the `workers.dev` URL is used; a domain needs a Cloudflare zone).

## 1. Facts

### 1.1 Verified (source or probe)

X API:

| Fact | Proof |
|---|---|
| `POST /2/tweets` (OAuth 2.0 user token; `text`, `media.media_ids`, `reply.in_reply_to_tweet_id`, `made_with_ai`; 201 → `data.id`); up to **4 photos or 1 GIF or 1 video**; quote posts need Enterprise | docs.x.com create-post |
| Live: three posts (plain, `https://` URL, bare domain) → 201 each; `DELETE /2/tweets/:id` → 200 `{"deleted": true}`; `x-rate-limit-limit: 100` per user per 15 min | `.plans/spike-x-oauth/u4_results.json` |
| Media: simple `POST /2/media/upload` for images; GIFs chunked (`initialize/append/finalize` + status); `media.write`; images ≤ 5 MB, GIFs ≤ 15 MB; media ids expire | docs.x.com media |
| Rate limits: `POST /2/tweets` 100/15 min per user, 10,000/24 h per app; `DELETE` 50/15 min per user; `GET /2/tweets` 5,000/15 min per user; `GET /2/users/:id/tweets` 900/15 min per user | docs.x.com rate-limits |
| Pricing: create $0.015; create with URL $0.200; delete $0.010; read $0.005/resource; owned read $0.001 **only for the app owner's account**; 24 h UTC dedup; no media row | docs.x.com pricing |
| Metrics: `public_metrics`, `non_public_metrics` (user context, posts < 30 days) | docs.x.com metrics |
| Counting: 280 weighted, NFC, emoji/CJK = 2, URL = 23; twitter-text detects bare domains | docs.x.com counting-characters |
| **OAuth (U1, proved):** confidential client, HTTP Basic at `POST https://api.x.com/2/oauth2/token`; authorize at `https://x.com/i/oauth2/authorize`; PKCE S256; scopes `tweet.read tweet.write users.read media.write offline.access`; access token 2 h; **refresh tokens rotate and are single-use** (replay → 400 `invalid_request` "Value passed for the token was invalid."; the replay does not revoke newer tokens); a `http://127.0.0.1` callback is accepted; connecting needs no credits | `.plans/spike-x-oauth/RESULTS.md` |

xAI remote MCP (U9, proved):

| Fact | Proof |
|---|---|
| `tools=[{"type":"mcp","server_url","server_label","authorization","allowed_tools"}]`; `authorization` bare or `Bearer …` both arrive as `Bearer …`; **no redirects followed**; each listing and call is a fresh `initialize → initialized → request` (protocol `2025-11-25`, client `rmcp`); `allowed_tools` filtered client-side; tool names shown as `grokchat___<tool>`; a wrong token fails the whole Grok request (HTTP 400); **resources never read**; **hard 60 s tool timeout**, and our handler keeps running after it | `.plans/spike-u9/RESULTS.md` |

Cloudflare (spike on the owner's free account, `.plans/spike-cf-ts/RESULTS.md`, and docs):

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
| Workers Free: 100k requests/day; 10 ms CPU nominal per invocation; no wall-time limit for HTTP, 15 min for cron; **50 subrequests per invocation**; 128 MB memory; 5 cron triggers; 64 MiB script | developers.cloudflare.com workers/platform/limits |
| Durable Objects Free: SQLite-backed only; 100k requests/day; 13,000 GB-s/day; 5M rows read/day; 100k rows written/day; 5 GB | durable-objects/platform/pricing |
| D1 Free: 10 databases, 500 MB each, 5 GB per account, **50 queries per invocation**, 30 s per query | d1/platform/limits |
| Workers Paid ($5/month) fallback: 30 s CPU default, 10M requests/month | workers/platform/pricing |
| Tooling exists with permissive licences: vitest 5.0.5, @cloudflare/vitest-pool-workers 0.23.0, @vitest/coverage-istanbul 5.0.5, dependency-cruiser 18.7.0, @stryker-mutator/core + vitest-runner 10.1.1 (Apache-2.0), fast-check 4.10.2, hono 4.13.14, eslint 10.13.0, typescript-eslint 8.72.1, prettier 3.9.10, license-checker-rseidelsohn 5.0.1 (BSD-3), htmx.org 2.0.11 (0BSD), zod 4.6.7, wrangler 4.153.0, @cloudflare/workers-types 5.20261027.1 | `npm view`, 2026-10-27 |

### 1.2 Still unverified (each has its proof step)

- U4 What triggers the $0.20 "with URL" row. Posts are done (plain, https URL, bare domain); the owner reads the Usage page counts. Until then, any twitter-text-detected URL is priced $0.20.
- U14 The token-endpoint error for a **revoked** refresh token (vs `invalid_request` for a stale one). Proof: `POST /2/oauth2/revoke`, then refresh.
- U15 D1 `batch()` is atomic (all-or-nothing) and runs in order. Proof: a batch whose second statement violates a constraint; assert the first rolled back (locally via vitest-pool-workers and once on deployed D1).
- U16 Whether a Durable Object stub call and a D1 query each count toward the **calling** Worker's 50-subrequest / 50-D1-query limits, and whether each DO invocation has its own budget. Proof: a spike Worker making 60 DO calls and 60 D1 queries in one invocation.
- U17 Whether R2 works on the free plan without a payment method; the DO SQLite row/value size limit. Fallback: staged media in DO storage as ≤ 1 MB chunks.
- U18 Whether Workers `fetch()` reaches private/loopback addresses (SSRF surface). Proof: spike fetches to `127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `[::1]`. The guard stays regardless.
- U19 Sustained CPU: whether Cloudflare starts rejecting MCP requests that keep exceeding 10 ms (p90 is above it). Proof: a day of real traffic in `wrangler tail`; fallback Workers Paid.
- U20 `@cloudflare/vitest-pool-workers` 0.23.0 runs with vitest 5.0.5 and gives D1 + DO bindings in tests. Proof: PR 1 skeleton test.
- U13 Weighted length and URL detection in TypeScript: the official `twitter-text` npm package (Apache-2.0, last released 2018) is checked against the upstream conformance YAML in PR 2; if it fails, vendor its config + regexes behind a pure function.

## 2. Costs

- **Cloudflare: $0** at our load: ≈ 1,440 cron ticks/day × 3 crons + MCP (≈ 100 posts × 3 requests + reads) + dashboard ≪ 100k requests/day; D1 and DO well inside their quotas.
- X (10 accounts × 10 posts/day ≈ 3,000 posts/month): no link $45/month; a URL in every post $600/month (`link_policy` and a per-create estimate; recommendation: link in bio). Metrics ≈ $68/month (6 decaying reads, same-day dedup). Delete $0.010 each. Media upload: no price row (`unknown`).
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
- Accounts: `Account(id, xUserId, handle, personalityId, status: ACTIVE|PAUSED|DISCONNECTED, disclosure(bioConfirmed, automatedLabelConfirmed), policy, isAppOwner)`; `PostingPolicy(mode: AUTO|REVIEW, dailyCap, minGap, quietHours?, tz, linkPolicy, grace)`.
- `checkPublishable(account, post, now, recent) → Allowed | Refused(reason)`: ACTIVE, disclosure, link policy, quiet hours, cap and min-gap over every post with a part SENDING, SENT or UNKNOWN in the account's tz day.
- Posts: `PartState = PENDING | SENDING(attemptAt) | SENT(xPostId) | UNKNOWN(attemptAt) | NOT_FOUND | REJECTED(reason) | DELETED`; `Post(id, accountId, parts, lifecycle, publishAt, resumeAt?, idempotencyKey, requestHash, createdBy, provenance(botId?, personalityVersion, policySnapshot), version)`; `Lifecycle = DRAFT | PENDING_REVIEW | SCHEDULED | RESUMING | PUBLISHING | DONE | CANCELLED | MISSED`; `derivedStatus`; `transition(post, event) → Post | Refused` (§3.1.1); `mapXOutcome(error) → PartEvent`; `missed(post, now)` measured from the original `publishAt`; `metricsDue`; `estimateCost`; `redact`.
- **New in rev 5:** `refreshOutcome(httpStatus, errorCode) → Rotated | Stale | Revoked | Retryable` (U1/U14). `invalid_request` on a token we hold as current means we lost a rotation (a bug: alert, do not mark the account DISCONNECTED) until U14 shows how a revoked token differs.

#### 3.1.1 Transition table (exhaustive-test spec; any pair not listed is Refused)

Rev 4's lease rows are replaced by **in-flight ownership by the account's Durable Object** (§3.5). There is exactly one `AccountPublisher` per account, so a post that is PUBLISHING but not in that object's in-memory in-flight set means the work died with the object.

| From | Event | To |
|---|---|---|
| DRAFT | submit (AUTO) | SCHEDULED (publishAt = given or now) |
| DRAFT | submit (REVIEW) | PENDING_REVIEW |
| DRAFT, PENDING_REVIEW, SCHEDULED (all parts PENDING) | edit | same (version+1) |
| DRAFT, PENDING_REVIEW, SCHEDULED (all parts PENDING) | cancel | CANCELLED |
| PENDING_REVIEW | approve | SCHEDULED (past publishAt → now) |
| PENDING_REVIEW | reject | CANCELLED |
| SCHEDULED | DO starts it (now ≥ publishAt, not missed) | PUBLISHING (version+1; added to the DO's in-flight set) |
| RESUMING | DO starts it (now ≥ resumeAt) | PUBLISHING (version+1) |
| SCHEDULED (all parts PENDING) | missed (now > publishAt + grace) | MISSED |
| PUBLISHING | ReservePart k Allowed | part k SENDING (D1 write awaited **before** the X call) |
| PUBLISHING | ReservePart k Refused (paused, undisclosed, cap, gap, quiet hours) | k = 1: SCHEDULED; k > 1: RESUMING (resumeAt = next allowed) |
| PUBLISHING | part k sent(xId) | part SENT; last part → DONE (PUBLISHED) |
| PUBLISHING | part k unknown | part UNKNOWN; DONE (UNKNOWN_OUTCOME) |
| PUBLISHING | part k rejected | k = 1: DONE (FAILED); k > 1: DONE (PARTIALLY_PUBLISHED) |
| PUBLISHING | part k retryable or 429(user) | part PENDING; k = 1: SCHEDULED; k > 1: RESUMING (resumeAt = retryAt or now + 1 min) |
| PUBLISHING | 429(app) | as retryable; the tick stops dispatching |
| PUBLISHING | VersionConflict on any save | stop this post, send nothing more; recovery below resolves it |
| PUBLISHING | worker yields (budget) | nothing SENT → SCHEDULED; some SENT → RESUMING (resumeAt = now) |
| PUBLISHING, not in-flight, no part SENDING, none SENT | recover | SCHEDULED (version+1) |
| PUBLISHING, not in-flight, no part SENDING, some SENT | recover | RESUMING (resumeAt = now) |
| PUBLISHING, not in-flight, a part SENDING | recover | that part UNKNOWN; DONE (UNKNOWN_OUTCOME); never re-sent |
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
| `PostReader` | `get(id)`, `findByIdempotency(botId, key)`, `list(filter)`, `dueAccounts(now)` |
| `PostWriter` | `add(post) → Added | Duplicate(existing)` (unique `(bot_id, idempotency_key)`), `save(post, expectedVersion, expectedLifecycle) → Ok | VersionConflict`, `saveAll(posts)` (one atomic D1 batch, U15) |
| `AccountRepository`, `PersonalityRepository`, `MediaRepository` | get / list / save |
| `MediaBlobStore` | `put(bytes, contentType) → key`, `get(key)` (R2 or DO chunks, U17) |
| `MediaFetcher` | `fetch(httpsUrl, maxBytes, allowedTypes) → bytes` (SSRF guard in the driver, U18) |
| `AccountPublishing` | `publishDue(accountId, now, budgetMs) → Summary`, `publishNow(accountId, postId, budgetMs) → Summary`, `reconcile(accountId, now)`, `collectMetrics(accountId, now)` — the use-case-facing port to the account's Durable Object |
| `AccountLock` | `run(fn)` — serialisation inside the account's object (the use case asks for it; the driver is an async mutex) |
| `TokenProvider` | `accessToken(accountId) → AccessToken | Revoked` — refresh under the account lock; persist the rotated token before returning |
| `MetricsRepository`, `AuditLog`, `CostLedger`, `OAuthStateStore`, `LoginThrottle` | as rev 4 |
| `XPublisher`, `XMediaUploader`, `XMetricsReader`, `XOwnTimelineReader`, `XAccountConnector` | as rev 4 (take `accountId`, never tokens) |
| `Clock`, `IdGenerator` | as rev 4 |

### 3.3 Use cases (every input carries `actor`; every interactor authorises against the loaded resource)

1. `createPost` (single or thread): idempotency key required for bots (`Duplicate` with a matching `requestHash` → existing post; mismatch → `idempotency_mismatch`); validates parts, media ownership, link policy, offset-aware `publishAt`; submits per §3.1.1; AUTO and due → `AccountPublishing.publishNow` with a **10 s budget** (well inside xAI's 60 s); on budget exhaustion it returns the derived status and the next tick finishes.
2. `editPost`, `cancelPost`, `approvePost`, `rejectPost`, `reschedulePost`.
3. `stageMediaFromUrl` (bot, ≤ 20 s) and `stageMediaUpload` (dashboard; direct POST ≤ 4 MB; magic-byte check).
4. Run service `PublishPost`, executed inside the account's DO under `AccountLock`: for each PENDING part, **ReservePart** = load the account and recent activity from D1 → `checkPublishable` → version-guarded D1 write of part SENDING (awaited) → **then** `XPublisher.create`, outside any transaction → version-guarded write of SENT; errors through `mapXOutcome`; a VersionConflict stops the post. `MediaStager` uploads media just before its part.
5. `publishDueTick` (cron `* * * * *`): one D1 query for `dueAccounts(now)`, then `AccountPublishing.publishDue(account, now, budget)` per account (fan-out, so each DO has its own budgets, U16); an app-scope 429 stops dispatch. Each DO first runs **recovery** on its own PUBLISHING posts that are not in its in-flight set.
6. `reconcileTick` (cron `*/10`): per account, UNKNOWN parts → `XOwnTimelineReader.recent(since = attemptAt − 60 s, 5)` with a normalised text match (+ `in_reply_to` for thread parts).
7. `deletePost`.
8. `metricsTick` (cron `*/15`): per account, posts where `metricsDue`, ≤ 100 ids per call.
9. Read side: `getPost`, `listBacklog`, `getCalendar`, `getPostMetrics`, `getAccountMetrics`, `comparePosts`, `getPersonality`, `getPolicy`, `costTotals`, `auditList`.
10. Admin: `savePersonality`, `setPolicy`, `setAccountStatus` (kill switch), `confirmDisclosure`, `connectAccountBegin` / `connectAccountComplete` (PKCE + state bound to the admin session; reconnect refuses a different `xUserId`; new accounts start PAUSED).

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
- **`AccountPublisher` Durable Object** (one per account, `idFromName(accountId)`): hosts `PublishPost`, recovery, reconcile and metrics for its account. An **async mutex** (a promise chain) serialises publishing and token refresh — not `blockConcurrencyWhile`, whose 30 s reset is shorter than an X call (connect 5 s + read 20 s) plus D1 writes. An in-memory in-flight set of post ids. Its SQLite storage holds the account's **encrypted token set**, so refresh stays inside the serialiser. Every method catches and maps errors (an uncaught throw resets the object) and checks its remaining budget before starting a part, never mid-send.
- **D1 (`grokchat`):** posts, parts, accounts, personalities, staged-media metadata, metrics, audit, cost, OAuth state, login throttle. Version-guarded `UPDATE … WHERE id = ? AND version = ? AND lifecycle = ?`; unique `(bot_id, idempotency_key)`; multi-row changes as one `batch()` (U15). Migrations with `wrangler d1 migrations apply` (own database, no deploy windows). Every Worker and DO method has a fixed, tested D1 query count (≤ 40, under the 50 limit).
- **Media:** R2 bucket `grokchat-media` if U17 passes; else DO-storage chunks. `stage_media_from_url`: https only, host allowlist, size caps, magic bytes, redirects re-checked (U18).
- **X drivers:** `fetch` with `AbortSignal.timeout` (≤ 20 s); a failure before the request is sent → `XRetryable`; a timeout or 5xx after sending → `XOutcomeUnknown`; 429 with `x-rate-limit-*` → `XRateLimited(scope)`; refresh errors through `refreshOutcome`.
- **Token vault:** AES-GCM with keys from secret `GROKCHAT_TOKEN_KEYS` (comma-separated, newest first; ciphertext carries the key id).
- **Dashboard:** Hono, server-rendered HTML, vendored htmx (SHA-384 pinned). Session: signed cookie (HMAC-SHA-256, `SameSite=Strict; Secure; HttpOnly`, 12 h); CSRF token per session and an Origin check on every non-GET route; admin password hash PBKDF2-SHA-256 via WebCrypto (iteration count measured against the CPU budget; login is rare); `LoginThrottle` in D1.
- **OAuth connect:** `/oauth/x/start` and `/oauth/x/callback` behind the admin session; the Worker's callback URL is added to the X app.

### 3.6 Deployment

- One Worker `grokchat` on the owner's free Cloudflare account. The owner renames the account's `workers.dev` subdomain from `grokchat-spike-ts` first.
- `wrangler.jsonc`: D1 binding `DB` (`grokchat`), DO binding `ACCOUNT` (`AccountPublisher`, `new_sqlite_classes`), R2 binding if U17, crons `* * * * *`, `*/10 * * * *`, `*/15 * * * *`, observability on.
- Secrets: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `GROKCHAT_BOT_CLIENTS`, `GROKCHAT_TOKEN_KEYS`, `GROKCHAT_SESSION_SECRET`, `GROKCHAT_ADMIN_PASSWORD_HASH`. Vars: `GROKCHAT_PUBLIC_ORIGIN`, `GROKCHAT_MEDIA_HOSTS`.
- Deploys by hand (`wrangler deploy`) from a release on `main`; no Git integration.
- Bots: `server_url = https://grokchat.<subdomain>.workers.dev/mcp`, `authorization = <bot token>`. Runbook: test each bot's token with one `get_policy` call (a wrong token fails the whole Grok request).

## 4. Risks and proofs

- R1 Double send. One DO per account + async mutex + SENDING written before the X call + version-guarded D1 writes + recovery rows. Proof (vitest-pool-workers, real local DO + D1): 10 concurrent `publishNow` for one account with cap 3 → exactly 3 sends; **negative control** with the mutex disabled → more than 3 (the spike saw 5). A stale write after recovery → VersionConflict, no send.
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
- R16 Per-invocation limits (U16): each Worker and DO method's D1-query and subrequest counts asserted ≤ 40.
- R17 DO reset by a throw: a test throws inside a part; the object recovers its post per §3.1.1.

## 5. Repo layout and tooling (TypeScript equivalents of Asterion's gates)

`package.json` + `package-lock.json` (npm, exact versions), `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `wrangler.jsonc`, `.dev.vars.example`, `migrations/` (D1 SQL).

| Asterion gate | GrokChat |
|---|---|
| import-linter layers + vendor bans | dependency-cruiser rules |
| pyright strict | `tsc --noEmit` strict (+ the flags above) |
| ruff ALL | ESLint (typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`) + Prettier |
| pytest + coverage ≥ 90% line and branch | Vitest + `@cloudflare/vitest-pool-workers` (tests run in workerd with real local D1 and DO); istanbul thresholds `lines: 90, branches: 90`, each enforced separately |
| Hypothesis | fast-check |
| mutmut | Stryker (vitest runner) on entities, use cases, interface adapters; no surviving mutants |
| pip-licenses / pip-audit | license-checker-rseidelsohn (allowlist) + `npm audit --omit=dev` |
| pre-commit hooks + gitleaks | the same pre-commit config with gitleaks + `npm run check` |
| no utils modules; ≤ 40-line functions; ≤ 400-line modules | ESLint `max-lines-per-function: 40`, `max-lines: 400`; dependency-cruiser forbids `utils|helpers|common|misc` paths |

`docs/decisions/`: the TypeScript exception; one record per runtime dependency (`@modelcontextprotocol/sdk`, `zod`, `hono`, htmx, twitter-text); hosting on Cloudflare. `docs/architecture.md`, `docs/runbook.md`, `CHANGELOG.md`, `CONTRIBUTING.md` (the one-line full local check). `.github/workflows/ci.yml` runs the same check once Actions billing is fixed (ASTERION-42); until then every PR pastes the local check output.

## 6. Tests

- `tests/architecture/`: dependency-cruiser passes; ports import only entities; no vendor types in port signatures (a compiler-API scan); entities have no I/O imports and no mutable state.
- `tests/contract/`: one suite per port, run against the in-memory stub **and** the real driver (D1 and DO through vitest-pool-workers; X drivers against fetch fixtures shaped from the docs; a `live` suite for real X, never in CI).
- `tests/invariants/`: I1 each part sent at most once (R1, R4); I2 scope (R7); I3 no send for PAUSED/DISCONNECTED/undisclosed; I4 UNKNOWN never re-sent without the confirmation; I5 every X call has a cost and an audit entry; I6 no secrets anywhere; I8 idempotency under concurrency (R14); I9 per-invocation query and subrequest counts (R16).
- `tests/unit/`: every interactor on stubs; §3.1.1 exhaustively; fast-check on policies (cap, gap, quiet hours across time zones and DST, `missed`, `metricsDue`, `estimateCost`) and `redact`; twitter-text conformance (U13).
- `tests/integration/`: through `main.ts` in workerd: MCP SDK client → `create_post` → `scheduled()` → published (stub X); wrong token 401; `/mcp` without redirect; dashboard login → CSRF → approve → tick.
- Coverage ≥ 90% line and branch (separate thresholds); 100% target on entities and use cases; Stryker with no survivors.

## 7. Delivery

### 7.0 Spike 2 (before PR 1; throwaway, deleted after)

U15 (D1 batch atomicity), U16 (per-invocation limits for DO calls and D1 queries), U17 (R2 on free; DO value size), U18 (Workers fetch to private addresses), U20 (vitest-pool-workers with vitest 5), U14 (revoked-token error). If any fails, the plan changes before PR 1.

### 7.1 PRs (one GROKCHAT ticket each; each leaves the full local check green)

1. Skeleton & tooling: package, tsconfig, ESLint/Prettier, dependency-cruiser, Vitest + pool, coverage thresholds, Stryker, licence check, decision records, `main.ts` with `/health`.
2. Entities & use cases on in-memory stubs: §3.1–3.3, the transition table, twitter-text (U13), unit / property / invariant tests, Stryker.
3. D1 + DO drivers: migrations, repositories, `AccountPublisher` with the mutex, in-flight set and recovery, token store, media store; concurrency tests with negative controls (R1, R3, R4, R14, R17).
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
