# GrokChat v0 — implementation plan (rev 4, converged)

Status: **converged** after 4 review rounds (feasibility converged in round 3, architecture in round 4). §10–§12 map every finding to its change. Owner decisions are **[decided]**; open facts are **[unverified]** and block the step that depends on them.

Evidence (probes, doc snapshots, logs): `.plans/evidence/feasibility-r1/`, `-r2/`, `-r3/`.

> **2026-10-27, owner decision: Cloudflare only (TypeScript).** Workers + D1 + Durable Objects + Cron Triggers on the free plan, proved in `.plans/spike-cf-ts/RESULTS.md`. This supersedes the Vercel/Supabase hosting, the MuseChat-database fence and the Postgres persistence below; the plan is being rewritten as rev 5 and goes back through review before any code.

## 0. What and why

Grok bots (one per personality) research X, write scripts in their personality's voice, and call the **GrokChat MCP server** to post them on that personality's X account. GrokChat is the only component that touches X. A dashboard shows the backlog, the calendar, metrics, costs and the controls. GrokChat generates no content.

Owner decisions:

- **[decided]** Official X API v2 only.
- **[decided]** n accounts, one personality each (1:1 in v0, modelled so it can become 1:n).
- **[decided]** **Posting only:** create (single post or thread), schedule, publish now, edit/cancel before publishing, delete our own post, read metrics. No replies to others, likes, reposts, quotes, follows, DMs. (Quote posts also need X Enterprise.)
- **[decided]** Auto-publish by default; a per-account policy can switch an account to `review`.
- **[decided]** Every account's bio says MuseChat runs it, and the account carries X's "automated" label. Publishing is refused until both are confirmed on the dashboard.
- **[decided]** Secrets in env vars (local gitignored `.env`; Vercel project env vars). Infisical later.
- **[decided 2026-10-27]** Hosting: **Vercel Hobby (free)** on the owner's personal team (`karl-michauds-projects`): GrokChat and MuseChat make no money, so Hobby's non-commercial rule is met (owner's call). Hobby cron runs once a day, so the per-minute triggers come from outside Vercel (§3.6, open: which trigger).
- **[decided 2026-10-27]** Database: **MuseChat's Supabase project** (`rwcnongdncmrhzvbesqy`), fenced off (§3.6). A separate free project was tried and refused (the owner's 2-free-project limit). Migrations need the owner's explicit go-ahead per change.
- Rejected, with proof: Cloudflare Workers Free for the Python MCP server (`1102` resource limit on the first MCP request, `.plans/spike-cf/`); Vercel Pro and Workers Paid (owner wants $0).
- **[decided]** Python 3.12, `uv`, Clean Architecture + SOLID, Agents/CLAUDE.md §7.1 in full.

Out of scope for v0: video; quote/reply/like/repost/follow; multiple personalities per account; Premium long posts (280 weighted characters for every account); Infisical; any LLM inside GrokChat.

## 1. Facts

### 1.1 Verified (source or probe)

| Fact | Proof |
|---|---|
| `POST /2/tweets`: OAuth 2.0 user token; body `text`, `media.media_ids`, `reply.in_reply_to_tweet_id`, `made_with_ai`; `additionalProperties:false`; 201 → `data.id`. A post takes up to **4 photos or 1 GIF or 1 video**. | docs.x.com create-post (snapshot in evidence) |
| Media: simple `POST /2/media/upload` is for images; GIFs use chunked `initialize/append/finalize` + status polling; scope `media.write`; images ≤ 5 MB, GIFs ≤ 15 MB; media ids expire (`expires_after_secs`). | docs.x.com upload-media, media introduction |
| OAuth 2.0: access token 2 h; refresh token only with `offline.access`; confidential client authenticates with HTTP Basic at `POST /2/oauth2/token`. Scopes we request: `tweet.read tweet.write users.read media.write offline.access`. | docs.x.com authorization-code, user-access-token |
| Rate limits: `POST /2/tweets` 100/15 min per user, 10,000/24 h per app; `DELETE /2/tweets/:id` 50/15 min per user; `GET /2/tweets` 5,000/15 min per user; `GET /2/users/:id/tweets` 900/15 min per user. | docs.x.com rate-limits |
| Pricing (pay-per-use): create $0.015; create with URL $0.200; delete $0.010; read $0.005/resource; **owned read $0.001 only when the user is the developer app's owner**; 24 h UTC dedup ("soft guarantee"); 3M reads/month cap; spending limit settable; **no media-upload row**. | docs.x.com pricing |
| Metrics: `public_metrics` (impression, like, reply, retweet, quote, bookmark), `non_public_metrics` (url_link_clicks, user_profile_clicks, engagements) need user context and posts < 30 days old. | docs.x.com metrics |
| Counting: 280 weighted, NFC, emoji/CJK weigh 2, every URL = 23; twitter-text detects bare domains. | docs.x.com counting-characters |
| xAI remote MCP: `{"type":"mcp","server_url","server_label","authorization","headers","allowed_tools"}`; Streamable HTTP or SSE; documents **tools** only. | docs.x.ai remote-mcp |
| mcp 2.3.0 works stateless + JSON behind bearer auth **with four fixes**: `auth=AuthSettings(issuer_url=…, resource_server_url=None)` is required with `token_verifier`; the parent app's lifespan must enter `mcp_app.router.lifespan_context` (else 500 "Task group is not initialized"); `transport_security` must allow the real host (else 421); mount gives `/mcp/` (POST `/mcp` → 307). `tools/call` works without `initialize`. Refusals: `ToolError` keeps the message; structured output needs a pydantic return model. | probes `srv.py`, `client_raw.py`, `client_sdk.py` |
| mcp 2.3.0 pulls `httpx2`, `uvicorn`, `pyjwt`, `jsonschema`, `opentelemetry-api`, `sse-starlette`. psycopg is LGPL-3.0-only. | `uv tree` in probe env |
| Postgres via a transaction-mode pooler (PgBouncer 1.26.1 stand-in for Supavisor): `prepare_threshold=None` required (default → `DuplicatePreparedStatement`); `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING` claimed 50 rows exactly once across 8 threads; a `FOR UPDATE` refresh lock gave exactly one refresh across 5 callers. | `db_probe.py` |
| Vercel: Hobby is non-commercial only → **Pro required**; Cron = **GET to the production deployment only**, `Authorization: Bearer $CRON_SECRET`, best effort (can skip or double-fire, never retries); Pro per-minute; function max 300 s default / 800 s; **request/response body ≤ 4.5 MB**; FastAPI lifespan supported (shutdown ≤ 500 ms); previews sit behind Vercel Authentication. | vercel.com docs: fair-use, cron-jobs, manage-cron-jobs, functions/limitations, frameworks/backend/fastapi |
| Postgres 17 behind a transaction pooler (round 2): the CTE claim in §3.5 claims exactly once with ≤ 1 post per account across 8 concurrent claimers; `DISTINCT ON` + `FOR UPDATE` is rejected; exactly-once comes from the outer `lifecycle='SCHEDULED'` guard (or FOR UPDATE), non-blocking from `SKIP LOCKED`; session advisory locks are **unsafe** through the pooler; RLS with no policy blocks a non-owner role (0 rows, inserts refused); a schema-only role is denied on `public`/`auth` tables but can EXECUTE `public` functions by default. | `feasibility-r2/db_r2.py`, `rls_probe.sql` |
| twitter-text: no maintained Python port; the archived MIT `twitter-text-parser` 3.0.0 passes upstream conformance (22/22 v3 counter, 91/91 URL extraction, 2/2 directional) once `pkg_resources` is replaced. | `feasibility-r2/tt_conf.py` |
| Supavisor accepts custom roles as user `grokchat_app.rwcnongdncmrhzvbesqy`. | supabase.com troubleshooting: tenant-or-user-not-found |
| Supabase Free: shared Supavisor only, 60 DB connections, 200 pooler clients, project pauses after ~7 days of low activity; transaction mode has no prepared statements. | supabase.com docs |
| MuseChat infra: Supabase `rwcnongdncmrhzvbesqy` serves MuseChat staging and production, changes only in owner-opened deploy windows; Vercel landing project deploys prebuilt by hand, Git integration off. | `MuseChat/supabase/README.md`, `MuseChat/web/landing/README.md` |

### 1.2 Still unverified (each has its proof step)

- U1 **Proved (2026-10-27, `.plans/spike-x-oauth/RESULTS.md`):** refresh tokens rotate on every refresh and are single-use (replaying an old one → 400 `invalid_request`, "Value passed for the token was invalid."); the replay does not revoke newer tokens; access tokens last 2 h; no credits needed. Refreshes are serialised per account and the new refresh token is persisted before use. A stale token is `invalid_request`, not `invalid_grant`; the error for a revoked token is measured after U4.
- U4 What triggers the $0.20 "with URL" row. Until proved, any twitter-text-detected URL is priced $0.20. Proof: one live probe under an X spending limit (PR 4).
- U9 **Proved (2026-10-27, `.plans/spike-u9/RESULTS.md`)**, via a cloudflared tunnel; the Vercel half stays in the spike. Facts and the design changes they force:
  - `authorization` may be the bare token or `Bearer <token>`; both arrive as `Bearer <token>`.
  - xAI does **not** follow redirects: GrokChat serves `/mcp` **and** `/mcp/` directly (an exact route to the MCP ASGI app, no 307), and the runbook gives bots `/mcp/`.
  - Each listing and each call is a fresh `initialize` → `initialized` → request, so one tool call is 3 HTTP requests (3 function invocations on Vercel; in the cost estimate).
  - `allowed_tools` is client-side only; our server-side scope checks stay the only fence (B1). The model sees tools as `grokchat___<tool>`, so tool descriptions name the tools that way.
  - A bad bot token fails the whole Grok request (HTTP 400), so the runbook includes a "test the bot's token" step.
  - Resources are never read: **v0 drops MCP resources**; `get_personality` / `get_policy` tools are the only way bots get them.
  - **Hard 60 s tool timeout**, and our handler keeps running after it: every tool must finish well inside 60 s (inline publish budget 10 s; `stage_media_from_url` capped at 20 s), and the idempotency key is what makes a retry after a timeout safe.
  - **Vercel half proved too** (`.plans/spike-vercel/RESULTS.md`, Hobby test project): the app with the lifespan fix runs on Vercel's Python runtime; the production alias is public and per-deployment URLs are protected (bots use the production domain); `allowed_hosts` from `VERCEL_PROJECT_PRODUCTION_URL` + `VERCEL_URL` (+ the custom domain); `/mcp` served by a path rewrite, no redirect; Grok → Vercel works; body limit 4.5 MB (413 above); `maxDuration` enforced (504 at 120 s); cron is `GET`, `vercel-cron/1.0`, `Authorization: Bearer $CRON_SECRET`, on the deployment-URL host.
- U11 **Disproved (2026-10-27, docs):** no Supabase key can be scoped to one bucket. S3 access keys "provide full access to all S3 operations across all buckets and bypass RLS policies" (supabase.com/docs/guides/storage/s3/authentication); secret keys use `service_role`, which "by design… has full access to your project's data", and "every key resolves to a built-in Postgres role" — only `anon`, `authenticated`, `service_role` (supabase.com/docs/guides/api/api-keys). The RLS route would need a GrokChat user in MuseChat's `auth.users`, which MuseChat's own `authenticated` policies might let read MuseChat data, so it is rejected. **Decision: staged media as `bytea` in `grokchat.staged_media`** (≤ 15 MB, purged 7 days after publish); dashboard uploads by direct POST capped at 4 MB (Vercel's 4.5 MB body limit); larger GIFs by URL fetch. No Supabase Storage, no `SignedUploadIssuer` in v0. **No service-role or secret key ever goes into GrokChat.**
- U12 MuseChat project's Supabase plan, connection limit and current use; Vercel team's plan. Proof: owner check in the dashboards (owner action, before PR 8).
- U13 **Resolved:** vendor the archived MIT port (`twitter-text-parser` 3.0.0) as pure code under `entities/text/`, `pkg_resources` replaced with `importlib.resources`, licence kept; upstream conformance YAML (Apache-2.0) as a test fixture. Decision record in PR 2.

## 2. Costs (shown on the dashboard; every X call writes a cost entry)

At 10 accounts × 10 posts/day ≈ 3,000 posts/month (a thread part is one create):

- Posts: no link $45/month; a URL in every post **$600/month**. Hence `link_policy` and a per-create estimate. Recommendation to the owner: link in bio.
- Metrics: 6 reads/post on a decaying schedule (+1 h, +6 h, +24 h, +3 d, +7 d, +29 d); reads that fall in the same UTC day count once, so ≈ 4–5 billed reads/post ≈ 13,500 × $0.005 ≈ **$68/month** (only the app owner's account gets $0.001).
- Reconcile: $0.005 × posts returned (`max_results=5`) per check; rare.
- Media upload: no price row; recorded as `unknown` and checked in the Developer Console in PR 4.
- Vercel Pro $20/seat + usage (≈ 50k cron invocations/month, inside included usage). Supabase: whatever MuseChat's plan is (U12).
- Owner action: set an X spending limit in the Developer Console before PR 8.

## 3. Architecture

Four layers, as in Asterion. Package `grokchat` under `src/`.

```text
frameworks/         MCP SDK server + tool shims, FastAPI app + routes + templates, httpx X drivers,
                    psycopg repos, token vault, access-token provider, storage, clock, ids, settings
interface_adapters/ controllers (plain values in), presenters (pydantic output models), view models,
                    boundary schemas
use_cases/          one folder per use case + ports/ + run services
entities/           frozen dataclasses + pure policies
main.py             composition root; exports `app` for Vercel
```

**Framework-free controllers (M1).** Controllers in `interface_adapters/` take plain values and call input boundaries. Everything that touches a vendor request object lives in `frameworks/`: the MCP tool shims read `get_access_token()`, build an entity `Actor`, and call the controller; FastAPI routes parse forms and the session into plain data. An architecture test asserts no module under `interface_adapters/` imports `mcp`, `fastapi`, `starlette`, `httpx`, `httpx2`, `psycopg`, `cryptography`, `jinja2`, `itsdangerous`.

One ASGI app: `/mcp/` (bots), `/dashboard/*` and `/oauth/x/*` (admin session), `/cron/*` (GET, `CRON_SECRET`).

### 3.1 Entities (`entities/`, stdlib only)

Identity and access:
- `AccountId`, `PersonalityId`, `PostId`, `BotId`, `XUserId`, `XPostId`, `IdempotencyKey`.
- `BotScope(bot_id, account_ids: frozenset[AccountId])`.
- `Actor = BotActor(scope) | HumanActor(name) | SystemActor(job)`.
- `authorize(actor, account_id) -> Allowed | Refused("scope")`: bots only for accounts in scope; humans and system for all. Pure; called by every interactor after it loads the resource (B1).

Content:
- `Personality(id, name, voice_guide, topics, dos, donts, examples, version)`.
- `StagedMedia(id, owner_account_id, kind: PHOTO|GIF, content_type, size, storage_key, sha256)` (m2).
- `PostPart(index, text, media: tuple[StagedMediaId, ...])`; `validate_part` enforces 280 weighted chars (U13) and media exclusivity (≤ 4 photos or 1 GIF) (F3).
- `contains_url(text)` (twitter-text detection, U13).

Accounts and policy:
- `Account(id, x_user_id, handle, personality_id, status: ACTIVE|PAUSED|DISCONNECTED, disclosure: Disclosure(bio_confirmed, automated_label_confirmed), policy, is_app_owner)`.
- `PostingPolicy(mode: AUTO|REVIEW, daily_cap, min_gap, quiet_hours|None, tz: str, link_policy: ALLOW|REFUSE, grace)`.
- `check_publishable(account, post, now, recent: RecentActivity) -> Allowed | Refused(reason)`: ACTIVE, disclosure complete, link policy, quiet hours, and cap + min-gap counted over every post with a part SENDING, SENT or UNKNOWN in the account's tz day (in-flight counts; M5, N1).

Posts (state per part, post status derived; M3):
- `PartState = PENDING | SENDING(attempt_at) | SENT(x_post_id) | UNKNOWN(attempt_at) | NOT_FOUND | REJECTED(reason) | DELETED`.
- `Post(id, account_id, parts, lifecycle, publish_at: aware datetime, resume_at?, idempotency_key, request_hash, created_by: Actor, provenance: Provenance(bot_id?, personality_version, policy_snapshot), lease_until?, version)` (m4).
- `Lifecycle = DRAFT | PENDING_REVIEW | SCHEDULED | RESUMING | PUBLISHING | DONE | CANCELLED | MISSED`. `RESUMING` = a post with at least one part SENT waiting to send the rest: never edited, never `missed`, `resume_at` separate from the original `publish_at` (N5).
- `derived_status(post)`: `PUBLISHED` (all parts SENT), `PARTIALLY_PUBLISHED` (some SENT, rest PENDING/REJECTED), `UNKNOWN_OUTCOME` (any part UNKNOWN), `NOT_FOUND` (a part NOT_FOUND), `FAILED` (part 1 REJECTED), `DELETED` (all sent parts DELETED), else the lifecycle.
- `transition(post, event) -> Post | Refused`, table in §3.1.1. `map_x_outcome(error) -> PartEvent` is a pure policy (m1): pre-send connect error → retryable (part stays PENDING; the post goes to SCHEDULED or RESUMING per §3.1.1); read timeout / 5xx / connection reset after send → UNKNOWN; 4xx reject → REJECTED; 429 → RATE_LIMITED(retry_at, scope=user|app).
- `missed(post, now)`: `now > publish_at + grace` measured from the **original** `publish_at` (M3).
- `metrics_due(published_at, snapshots, now)`; `estimate_cost(operation, has_url, is_app_owner, price_table) -> Decimal | UNKNOWN`.

Records:
- `MetricsSnapshot(x_post_id, taken_at, impressions, likes, reposts, replies, quotes, bookmarks, url_link_clicks?, user_profile_clicks?, engagements?)`.
- `AuditEvent(at, actor, action, post_id?, account_id?, detail)`; `CostEntry(at, account_id, operation, estimate, x_request_id?)`.
- `redact(text, secrets) -> text` pure, used by audit, errors and presenters (m10).

#### 3.1.1 Transition table (the exhaustive test's spec; any pair not listed is Refused)

| From | Event | To |
|---|---|---|
| DRAFT | submit (policy AUTO) | SCHEDULED (publish_at = given or now) |
| DRAFT | submit (policy REVIEW) | PENDING_REVIEW |
| DRAFT, PENDING_REVIEW, SCHEDULED (all parts PENDING) | edit | same (version+1); parts replaced |
| DRAFT, PENDING_REVIEW, SCHEDULED (all parts PENDING) | cancel | CANCELLED |
| PENDING_REVIEW | approve | SCHEDULED (if publish_at is past: publish_at = now, so grace restarts at approval) |
| PENDING_REVIEW | reject | CANCELLED |
| SCHEDULED | claim (now ≥ publish_at, not missed) | PUBLISHING (lease_until = now + LEASE, version+1) |
| RESUMING | claim (now ≥ resume_at) | PUBLISHING (lease, version+1) |
| SCHEDULED (all parts PENDING) | tick sees missed (now > publish_at + grace) | MISSED |
| PUBLISHING | ReservePart k: decision Allowed | PUBLISHING; part k SENDING; lease renewed (committed **before** the X call; N1) |
| PUBLISHING | ReservePart k: decision Refused (paused, undisclosed, cap, gap, quiet hours) | k = 1: SCHEDULED; k > 1: RESUMING (resume_at = when the gate next allows); written in the same transaction, version-guarded; post and account leases released |
| PUBLISHING | part k sent(x_id) | part SENT; last part → DONE (PUBLISHED) |
| PUBLISHING | part k unknown | part UNKNOWN; DONE (derived UNKNOWN_OUTCOME) |
| PUBLISHING | part k rejected | k = 1: DONE (FAILED); k > 1: DONE (PARTIALLY_PUBLISHED) |
| PUBLISHING | part k retryable or 429(user) | part k back to PENDING; k = 1: SCHEDULED (publish_at kept, `missed` applies); k > 1: RESUMING (resume_at = retry_at or now + 1 min) |
| PUBLISHING | 429(app) | as retryable for this post; the tick stops claiming (m9) |
| PUBLISHING | VersionConflict or LeaseLost on any save | the worker stops this post at once and sends nothing more; the reaper resolves it (N4, P3) |
| PUBLISHING | LeaseLost before `mark_sending` (nothing of this part sent) | as a yield: post back to SCHEDULED or RESUMING at once, version-guarded, instead of waiting for the reaper |
| PUBLISHING | worker yields: time budget exhausted before a claim or part, or `AccountLease` not acquired | nothing SENT → SCHEDULED; some SENT → RESUMING (resume_at = now); post lease cleared, version+1, version-guarded (P1). A tick yields every claimed post it has not started before it returns |
| PUBLISHING | lease expired, no part SENDING and none SENT | SCHEDULED (version+1; nothing was sent, so safe; `missed` applies) (N3/N4) |
| PUBLISHING | lease expired, no part SENDING, some SENT | RESUMING (resume_at = now) |
| PUBLISHING | lease expired, a part SENDING | that part UNKNOWN; DONE (derived UNKNOWN_OUTCOME) — never re-sent (B2) |
| (part) UNKNOWN | reconcile found x_id | part SENT; later parts PENDING → RESUMING (resume_at = now); else DONE (PUBLISHED) |
| (part) UNKNOWN | reconcile not found after 2 checks | part NOT_FOUND |
| NOT_FOUND post | human "re-send, I checked X" | that part PENDING; k = 1: SCHEDULED (publish_at = now); k > 1: RESUMING; audit records the confirmation (M4) |
| FAILED post | human re-schedule | SCHEDULED (parts PENDING, new publish_at) |
| MISSED | human re-schedule | SCHEDULED (new publish_at) |
| RESUMING | cancel | DONE (PARTIALLY_PUBLISHED; remaining parts abandoned) |
| RESUMING, PUBLISHING, DONE | edit | Refused |
| PUBLISHED / PARTIALLY_PUBLISHED | delete | each SENT part → DELETED, last first; a failed delete leaves that part SENT and the post shows "delete incomplete" |

LEASE = 180 s, with function `maxDuration` = 120 s, so an expired lease always means the worker is gone (N3). A tick claims only what fits its 90 s budget and checks the budget only before a claim or a part, never mid-send; whatever it doesn't start it yields (row above), so nothing waits on a lease after a normal stop.

### 3.2 Ports (`use_cases/ports/`; entity types only)

| Port | Methods |
|---|---|
| `PostReader` | `get(id)`, `find_by_idempotency(bot_id, key)`, `list(filter)` |
| `PostWriter` | `add(post) -> Added | Duplicate(existing)` (unique `(bot_id, idempotency_key)`; N6), `save(post, expected_version, expected_lifecycle) -> None | VersionConflict` (B2) |
| `PostClaimer` | `claim_due(now, limit) -> list[Post]` (≤ 1 per account), `claim(post_id, now) -> Post | NotClaimable`, `expired_leases(now) -> list[Post]` |
| `AccountRepository` | `get`, `list`, `save` |
| `AccountLease` | `acquire(account_id, holder, until) -> bool`, `renew`, `release` — a durable row lease, pooler-safe; serialises publishing per account (M5, N2) |
| `PublishTransactions` | `open(account_id, holder) -> PublishTransaction` — a unit of work, used only as a context manager. `PublishTransaction`: `renew_leases(post_id, until) -> Ok | LeaseLost` (step 1, the account-row UPDATE), `load_account_and_activity() -> (Account, RecentActivity)` (step 2, after the lock so it sees committed SENDING rows), `mark_sending(post, k, expected_version) -> Ok | VersionConflict` (step 4); commit on exit, rollback on error. **No policy in the port:** the use case calls `check_publishable` (step 3) between steps 2 and 4 (N1, P2, P3) |
| `PersonalityRepository` | `get`, `list`, `save` |
| `MediaRepository` | `get(id)`, `add(staged)` |
| `MediaBlobStore` | `put(bytes, content_type) -> storage_key`, `get(key) -> bytes` (driver: `bytea` in `grokchat.staged_media`; U11) |
| `MediaFetcher` | `fetch(https_url, max_bytes, allowed_types) -> bytes` (SSRF guard lives in the driver; F3) |
| `MetricsRepository` | `add_snapshot`, `series(account_id, window)`, `latest(x_post_ids)` |
| `JobLease` | `acquire(job, ttl) -> bool` (metrics and reconcile ticks don't overlap; m3) |
| `AuditLog` | `append`, `list(filter)` |
| `CostLedger` | `append`, `totals(window, account_id?)` |
| `XPublisher` | `create(account_id, text, x_media_ids, in_reply_to?) -> XPostId`, `delete(account_id, x_post_id)` |
| `XMediaUploader` | `upload(account_id, bytes, kind) -> XMediaId` (simple for photos, chunked for GIFs) |
| `XMetricsReader` | `read(account_id, x_post_ids) -> list[MetricsSnapshot]` |
| `XOwnTimelineReader` | `recent(account_id, since, max_results) -> list[XPostSummary(id, text_normalised, created_at, in_reply_to)]` (M4) |
| `XAccountConnector` | `authorize_url(state, code_challenge)`, `complete(code, verifier) -> ConnectedXUser` |
| `OAuthStateStore` | `put(state, verifier, session_id, expires_at)`, `take(state, session_id, now) -> verifier | Refused` (single-use; M7) |
| `LoginThrottle` | `allow(key, now) -> bool`, `record_failure(key, now)` (M8) |
| `Clock` | `now()` (aware UTC) |
| `IdGenerator` | `new_id()` |

X ports take `account_id`, never tokens (M6). Token handling is driver-side: `AccessTokenProvider` (frameworks) composes `TokenVault` (`load`/`store`, encrypted) and the X token endpoint; refresh runs under a `SELECT … FOR UPDATE` on the token row, re-reads after acquiring, commits the rotated token in the same transaction, `lock_timeout` 5 s. `invalid_grant` → `XAuthRevoked`, which the publish service maps to account DISCONNECTED + audit event.

Entity-level errors: `XRejected(reason)`, `XOutcomeUnknown`, `XRetryable`, `XRateLimited(retry_at, scope)`, `XAuthRevoked`, `NotFound`, `VersionConflict`, `Refused(reason)`.

### 3.3 Use cases (one folder each; every input_data carries `actor`)

Every interactor that addresses a post, media or account loads it first and calls `authorize(actor, resource.account_id)` (B1).

1. `create_post` (single or thread): requires `idempotency_key` for bots; `add` returning `Duplicate(existing)` returns that post if its `request_hash` matches, else `ToolRefusal("idempotency_mismatch")` (B3, N6). Validates parts, media ownership (`StagedMedia.owner_account_id == account_id`), link policy, `publish_at` (must be offset-aware; past beyond grace refused; m5). Submits per §3.1.1. If AUTO and `publish_at` ≤ now: calls `publish_now` with a 10 s budget; on budget exhaustion it yields the post (§3.1.1, P1) before the next part, never mid-send, and returns the derived status; the next tick (≤ 1 min) continues it (B3, F5). Returns post id, derived status, cost estimate, refusals.
2. `edit_post`, `cancel_post`, `approve_post`, `reject_post`, `reschedule_post` (human-only for NOT_FOUND/FAILED/MISSED; requires the confirmation flag for NOT_FOUND).
3. `stage_media_from_url` (bot): `MediaFetcher` → `MediaBlobStore` → `StagedMedia` (F3). `stage_media_upload` (dashboard): a direct POST ≤ 4 MB to the function, checked for size, type and magic bytes (U11, P4).
4. Run service `PublishPost` (shared by 1 and 5), split (m1):
   - Takes `AccountLease.acquire(account)`; not acquired → post back per §3.1.1 (another worker is publishing for that account).
   - `MediaStager`: uploads the part's staged media to X just before it is needed (re-upload if expired; GIF polling within the budget).
   - `ThreadSender`: for each PENDING part: the `ReservePart` step — `with PublishTransactions.open(...)`: (1) `renew_leases` (LeaseLost → stop), (2) `load_account_and_activity`, (3) `check_publishable` in the use case (Refused → transition per §3.1.1), (4) `mark_sending`, commit; then, **outside any transaction**, `XPublisher.create` (replying to the previous part's x id); then a version-guarded save of SENT; errors through `map_x_outcome`; any VersionConflict stops the post.
   - Releases the account lease at the end (an expired lease is reclaimable, so a crash never blocks an account longer than LEASE).
5. `publish_due_tick`: `claim_due(now, limit=<what fits the 90 s budget>)`; for each, `PublishPost`; an app-scope 429 stops the tick (m9); then the reaper: `expired_leases(now)` → transition per §3.1.1.
6. `reconcile_tick` (JobLease): for each UNKNOWN part, `XOwnTimelineReader.recent(account, since=attempt_at − 60 s, max_results=5)`; match on normalised text (t.co URLs expanded from entities, HTML unescaped, NFC, trimmed) plus `in_reply_to` for thread parts.
7. `delete_post` (bot or human, own account only; per §3.1.1).
8. `metrics_tick` (JobLease): posts where `metrics_due`, ≤ 100 ids per call per account.
9. Read side: `get_post`, `list_backlog(account_id?, status?, window)`, `get_calendar(window)`, `get_post_metrics(post_id)`, `get_account_metrics(account_id, window)`, `compare_posts(account_id, window, sort_by)`, `get_personality(account_id)`, `get_policy(account_id)`, `cost_totals`, `audit_list`.
10. Admin: `save_personality` (version+1), `set_policy`, `set_account_status` (kill switch), `confirm_disclosure`, `connect_account_begin` (state + PKCE stored, bound to the admin session), `connect_account_complete` (`take` state; `complete`; refuses if an existing account's `x_user_id` differs; new accounts start PAUSED until disclosure confirmed) (M7).

Decorators on X ports (frameworks, wired in `main.py`): `CostMetering*` (uses `estimate_cost` with the account's `is_app_owner`), `Auditing*`. Not inside interactors.

### 3.4 Interface adapters

- `controllers/mcp/`: one per tool; plain values in, presenter out. Refusals become `ToolRefusal(code, message)` values that the framework shim raises as MCP `ToolError` (F6).
- MCP tools: `create_post`, `create_thread`, `stage_media_from_url`, `edit_post`, `cancel_post`, `delete_post`, `get_post`, `list_backlog`, `get_post_metrics`, `get_account_metrics`, `compare_posts`, `get_personality`, `get_policy`. Account-addressed tools take `account_id`; post-addressed tools take only `post_id` (B1). No MCP resources in v0: xAI never reads them (U9).
- `presenters/`: pydantic output models (structured output; F6), all strings through `redact`.
- `controllers/dashboard/` + `view_models/`: backlog, calendar, post detail (edit/approve/reject/cancel/delete/reschedule), accounts (connect, disclosure, policy, kill switch), personalities, metrics, costs, audit.
- `controllers/cron/`: `publish_due`, `reconcile`, `metrics`.

### 3.5 Frameworks & drivers

- `mcp_app.py`: builds a fresh `MCPServer("grokchat", token_verifier=BotTokenVerifier, auth=AuthSettings(issuer_url=<own url>, resource_server_url=None))` per `build_app()`; tool shims; `streamable_http_app(stateless_http=True, json_response=True, streamable_http_path="/", transport_security=TransportSecuritySettings(allowed_hosts=settings.public_hosts, allowed_origins=[]))` — every production host by exact name (the custom domain and the project's `vercel.app` alias; the SDK supports only port wildcards) (F1).
- `web.py`: FastAPI with `lifespan` entering `mcp_app.router.lifespan_context`; mounts `/mcp`; routes for dashboard, OAuth, cron (GET). Session cookie: `SameSite=Strict`, `Secure`, `HttpOnly`, max_age 12 h. CSRF: per-session token in every form and htmx header, plus Origin/Host check on every non-GET route (M8). Login: scrypt hash, `LoginThrottle` (5 failures / 15 min per IP + global).
- `bot_tokens.py`: `GROKCHAT_BOT_CLIENTS` = JSON `[{id, token_sha256, accounts}]`; tokens ≥ 32 random bytes; SHA-256 of the presented token compared against every entry with `hmac.compare_digest`, no early exit; returns `AccessToken(client_id=bot id, scopes=["account:<id>", …])`; the shim turns that into `BotScope`. An account id in the config that the DB doesn't know makes every call from that bot fail closed with `config_error` (m11).
- `x_http/`: httpx drivers per port; timeouts (connect 5 s, read 20 s); connect errors → `XRetryable`, read errors / 5xx → `XOutcomeUnknown`; `x-rate-limit-*` → `XRateLimited(scope)`; event hook redacts `Authorization`.
- `access_tokens.py`: `AccessTokenProvider` + `PostgresTokenVault` (`MultiFernet` keys from `GROKCHAT_TOKEN_KEYS`, comma-separated, newest first; m7).
- `postgres/`: psycopg 3 with `psycopg_pool.ConnectionPool(min_size=0, max_size=4, open=True, check=ConnectionPool.check_connection, kwargs={"prepare_threshold": None, "autocommit": True})`, opened in the FastAPI lifespan and closed on shutdown (≤ 500 ms), **one pooled connection per unit of work**, never shared between concurrent requests (N2). Session-level advisory locks are banned (unsafe through the pooler); no advisory locks at all in v0.
  - Claim (tested in its rev-3 form, `feasibility-r3/db_r3.py`):
    ```sql
    WITH locked AS (
      SELECT p.id, p.account_id, p.publish_at FROM grokchat.posts p
       WHERE p.lifecycle IN ('SCHEDULED','RESUMING') AND coalesce(p.resume_at, p.publish_at) <= $now
       ORDER BY coalesce(p.resume_at, p.publish_at) FOR UPDATE OF p SKIP LOCKED),
    pick AS (SELECT id FROM (SELECT DISTINCT ON (account_id) id, publish_at FROM locked
                             ORDER BY account_id, publish_at) d ORDER BY publish_at LIMIT $n)
    UPDATE grokchat.posts SET lifecycle='PUBLISHING', lease_until=$now+$lease, version=version+1
     WHERE id IN (SELECT id FROM pick) AND lifecycle IN ('SCHEDULED','RESUMING') RETURNING *;
    ```
    Account serialisation is the `AccountLease`, not this query (an inline `claim(post_id)` can race a tick on the same account).
  - Account lease (tested, `feasibility-r3`): acquire `UPDATE grokchat.accounts SET publish_lease_until=$until, publish_lease_holder=$h WHERE id=$a AND (publish_lease_until IS NULL OR publish_lease_until < $now OR publish_lease_holder=$h) RETURNING id`; renew (step 1 of a publish transaction) `… WHERE id=$a AND publish_lease_holder=$h AND publish_lease_until >= $now` — 0 rows → `LeaseLost`; release `… SET publish_lease_until=NULL, publish_lease_holder=NULL WHERE id=$a AND publish_lease_holder=$h`.
  - Claim ordering: within an account the oldest original `publish_at` goes first, so unfinished threads go before new posts (commented in the SQL).
  - `save`: `UPDATE … WHERE id=$id AND version=$v AND lifecycle=$l`. Unique index `posts(created_by_bot, idempotency_key)`.
  - Migrations: numbered SQL in `migrations/`, runner `scripts/migrate.py`, schema `grokchat`, refuses a non-local host without `GROKCHAT_MIGRATE_CONFIRM=rwcnongdncmrhzvbesqy`.
- `postgres/bytea_media.py`: the `MediaBlobStore` driver (`grokchat.staged_media`, purged 7 days after publish; U11).
- `media_fetch.py`: https only, host allowlist from settings (default: xAI image hosts, confirmed in the spike), DNS-resolved IP must be public, no redirects to non-allowlisted hosts, size cap 5 MB photo / 15 MB GIF, content-type and magic-byte check.
- `settings.py`, `clock.py`, `ids.py`.
- `main.py`: `app = build_app(Settings.from_env())`; `tool.vercel.entrypoint = "grokchat.main:app"`.

### 3.6 Deployment (reuses MuseChat's Supabase and Vercel team)

- **Schema `grokchat`**, own migrations in this repo; not added to the Data API's exposed schemas (a dashboard setting, checked by the owner). In SQL: RLS on every table with exactly one policy, `CREATE POLICY grokchat_app_all ON grokchat.<t> TO grokchat_app USING (true) WITH CHECK (true)` (without it the app's own role sees 0 rows); `anon`, `authenticated`, `service_role` get no USAGE on `grokchat`, so exposure would be harmless anyway. A migration test asserts all three.
- **Role `grokchat_app`** (pooler user `grokchat_app.rwcnongdncmrhzvbesqy`): USAGE + DML on `grokchat` only, nothing on `public`, `auth`, `storage` or MuseChat schemas; the `public` functions it can EXECUTE by default are listed by I7 for the owner to decide on. The Postgres contract suites run **as `grokchat_app`**, never as a superuser.
- **No Supabase service-role key in GrokChat's env, ever** (N7). A startup check (and I7) refuses any env value starting `sb_secret_` and any JWT whose `role` claim is anything other than `anon` (P4).
- **Migrations only in an owner-opened deploy window** (MuseChat's rule).
- **Media**: `bytea` in `grokchat.staged_media` (U11 disproved bucket-scoped keys); no Supabase Storage.
- **Vercel**: new project `grokchat` in the same team, Pro (U5 proved; U12 checks the team's plan). Git integration off, deploys by hand. `vercel.json`: crons `* * * * *` `/cron/publish_due`, `*/10 * * * *` `/cron/reconcile`, `*/15 * * * *` `/cron/metrics`; `maxDuration` 120 s. Cron runs only on production, so E2 is proved on production.
- **Env**: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`, `DATABASE_URL`, `GROKCHAT_TOKEN_KEYS`, `GROKCHAT_BOT_CLIENTS`, `GROKCHAT_ADMIN_PASSWORD_HASH`, `GROKCHAT_SESSION_SECRET`, `CRON_SECRET`, `GROKCHAT_PUBLIC_HOSTS`, `GROKCHAT_MEDIA_HOSTS`. `.env.example` lists names only.
- **Bots**: xAI Responses API, `tools=[{"type":"mcp","server_url":"https://<host>/mcp/","server_label":"grokchat","authorization":"<bot token>","allowed_tools":[…]}]` (exact `authorization` format from the spike).

## 4. Risks and proofs

- R1 Double post. Claim + lease + version-guarded save + reaper. Each property with its own negative control: **exactly-once** — conn 2 claims in a thread while conn 1 holds, conn 1 commits, sets disjoint; control: `FOR UPDATE` and the outer lifecycle guard removed → double claim. **Non-blocking** — conn 2 with `lock_timeout 1s` returns at once; control: `SKIP LOCKED` removed → `LockNotAvailable`. **≤ 1 per account** — two accounts × three due posts → exactly two claimed. Edit-after-claim → VersionConflict. Stale worker after a reap → VersionConflict, sends nothing.
- R2 Unknown outcome → reconcile; never re-sent. Proof: publisher stub raising `XOutcomeUnknown`; reconcile found / not found; NOT_FOUND re-send requires the confirmation.
- R3 Refresh race. Proof: two connections; conn 2 blocks on the token row lock, then sees the refreshed token; `refresh` called once; control without `FOR UPDATE` → two refreshes.
- R15 Yield (P1). Proof: unit rows for both yield outcomes; integration: inline `publish_now` exhausts its budget after part 1 of 3 → the next tick finishes the thread; a tick yields unstarted claims and they publish on the next tick with no lease wait.
- R4 Crash between X's 201 and our write. Proof: a contract test where the stubbed `create` first asserts, **from a second connection**, that part k is already SENDING (so wrapping the send in the transaction fails the test); then the store fails after `create` returns; the reaper makes the part UNKNOWN; reconcile finds it; it is never re-sent (M2, N1). Plus: worker killed before part 1 → reaper → SCHEDULED → published by the next tick (N3).
- R5 Tick duration on Vercel. Proof: production deploy in the spike; time a tick of 20 posts against the stub X driver (selected by env).
- R6 xAI ↔ MCP (U9). Proof: the spike.
- R7 Cross-account action. Proof: I2 parametrised over `server.list_tools()` × {account-addressed, post-addressed, media-addressed} with resources owned by another account: every call refused, nothing written, `scope_refused` audit.
- R8 Secrets leak. Proof: I6 asserts no secret in logs, audit `detail`, `last_error` or any presenter payload.
- R9 Link cost. Proof: `estimate_cost` + `contains_url` conformance tests (U13).
- R10 Policy race (M5). Proof: two connections run the publish transaction for one account with cap 1 → exactly one send. Negative controls that really break serialisation (P3): (a) load activity **before** the account-row UPDATE → two sends; (b) skip the UPDATE → two sends. Plus: a stale holder gets `LeaseLost` and sends nothing; `AccountLease.acquire` race → exactly one holder, control without its WHERE clause → all acquire. Plus an integration test with two concurrent requests in **one app instance** (shared pool) against PgBouncer → one send (N2).
- R11 OAuth CSRF / account swap (M7). Proof: tests for missing session, replayed state, expired state, foreign session, different `x_user_id` on reconnect.
- R12 Dashboard CSRF / brute force (M8). Proof: POST without token → 403; wrong Origin → 403; 6th failed login in 15 min → 429.
- R14 Idempotency race (N6). Proof: two concurrent creates with one key on two connections → one post, one X call; same key, different content → `idempotency_mismatch`.
- R13 SSRF via `stage_media_from_url`. Proof: tests for http, private IPs (10/8, 127/8, 169.254/16, ::1), redirect to a disallowed host, oversize, wrong magic bytes.

## 5. Repo layout and tooling (mirrors Asterion)

`pyproject.toml` (uv_build, `>=3.12,<3.13`, `Private :: Do Not Upload`, `tool.vercel.entrypoint`), `uv.lock`, `.python-version`, `.pre-commit-config.yaml` (Asterion's hooks), import-linter (layers; vendor modules only under frameworks: `mcp`, `fastapi`, `starlette`, `httpx`, `httpx2`, `psycopg`, `cryptography`, `jinja2`, `itsdangerous`, `multipart`; `pydantic` only in interface_adapters and frameworks), `scripts/ci/coverage_gate.py` (from Asterion), `.github/workflows/ci.yml` (with a `postgres:17` service; runs once ASTERION-42 is fixed), `CHANGELOG.md`, `CONTRIBUTING.md` (including `docker run` for local Postgres and the one-line full local check), `docs/decisions/`, `docs/architecture.md`, `docs/runbook.md`.

Runtime deps, each with a decision record: `mcp==2.3.0` (and what it pulls: httpx2, uvicorn, pyjwt, jsonschema, opentelemetry-api, sse-starlette), `fastapi`, `python-multipart`, `jinja2`, `itsdangerous`, `httpx`, `psycopg[binary]` + `psycopg_pool` (LGPL-3.0-only, unmodified), `cryptography`, `pydantic`, `tzdata`, the vendored twitter-text port (MIT; U13; its TLD lists refreshed from upstream/IANA, with a test on a post-2018 gTLD). Vendored htmx with a pinned SHA-384 (record). Dev deps as Asterion.

## 6. Tests

- `tests/architecture/`: import contracts; no vendor or pydantic types in port signatures (annotation inspection); controllers import no vendor module; entities are frozen dataclasses; no `utils`/`helpers`/`common`/`misc` modules; function ≤ 40 lines and module ≤ 400 lines unless a written reason.
- `tests/contract/`: one suite per port, run against the stub and the real driver. Postgres suites (marker `postgres`) on Docker Postgres 17 behind PgBouncer in transaction mode with `prepare_threshold=None`, connected **as `grokchat_app`** after the migrations ran as the owner role — the same shape as Supabase. X drivers against `httpx.MockTransport` fixtures shaped from the docs; marker `live` for real X (never in CI).
- `tests/invariants/`: I1 each part sent at most once (R1, R4); I2 scope (R7); I3 no send for PAUSED/DISCONNECTED/undisclosed accounts; I4 UNKNOWN never re-sent without the human confirmation; I5 every X call has a cost entry and an audit event; I6 no secrets anywhere (R8); I7 `grokchat_app` has no privilege on any non-`grokchat` table (`has_table_privilege` over `pg_class` returns nothing), the functions it can execute outside `grokchat` are listed (`has_function_privilege`), and no service-role key is in env; I8 same idempotency key → one post, one X call, under concurrency (R14).
- `tests/unit/`: every interactor on stubs; the §3.1.1 table exhaustively (every lifecycle × event, every part state × event); Hypothesis on policies (cap, gap, quiet hours across tz and DST, `missed`, `metrics_due`, `estimate_cost` monotonic) and on `redact`; twitter-text conformance (U13).
- `tests/integration/`: through `main.py` with stub drivers: MCP SDK client over the mounted ASGI app (with the lifespan) → create → tick → published; 401 without token; 421 on a wrong host; dashboard login → CSRF → approve → tick; cron GET with and without secret.
- Coverage ≥ 90% line and branch, gated separately; 100% target on entities and use_cases. **mutmut on entities, use_cases and interface_adapters; no surviving mutants in any of them** (m6), Postgres-marked tests excluded from mutmut.
- Every PR pastes the output of the full local check (ruff, pyright strict, import-linter, pytest with the coverage gate figures, mutmut summary) until CI runs (M15).

## 7. Delivery

### 7.0 Spike (scratchpad, before PR 1; nothing kept in the repo)

A minimal app (two tools, bearer auth, the four F1 fixes) deployed to **production** of a throwaway Vercel project in the team (cron and the bot need production; previews are protected). The owner makes one xAI Responses API call with a test bot token. Record: whether `authorization` needs the `Bearer ` prefix, that `/mcp/` works, timing, whether a resource is read. Also: a real Supabase connection as a temporary role in a scratch schema in an owner-opened window, running the claim SQL through Supavisor (U8 on the real pooler), (U11 already settled from the docs: `bytea`). If anything fails, the plan changes before PR 1.

### 7.1 PRs (one GROKCHAT ticket each; each leaves the full local check green)

1. **Skeleton & tooling** + architecture tests + decision records + `main.py` with a health route.
2. **Entities & use cases on stubs**: §3.1–3.3 (including the transition table, twitter-text decision U13), unit/property/invariant tests, mutmut.
3. **Postgres & storage drivers**: migrations, repos, claimer, `AccountLease`, `PublishTransactions`, vault, OAuth state store, login throttle, storage, media fetcher; deterministic concurrency tests with negative controls.
4. **X drivers**: publisher, media (simple + chunked), metrics, own timeline, connector, access-token provider, cost/audit decorators; contract suites; live smoke script (U1, U4, media cost) — run by the owner under a spending limit.
5. **MCP server**: shims, verifier, tools, presenters; integration tests; R7.
6. **Cron ticks**: publish_due, reapers, reconcile, metrics, JobLease; R2, R4, R10.
7. **Dashboard**: login, CSRF, throttle, OAuth connect routes (the connect flow is wired only here, behind the admin session; M15), backlog, calendar, post detail, accounts, personalities, metrics, costs, audit.
8. **Deploy**: migrations in an owner window, Vercel project, env vars, domain, runbook (connect an account, add a bot and its token, rotate a token key, kill switch, read costs), production checks E1–E9.

## 8. Exit criteria

- E1 A Grok bot creates a post through GrokChat and it appears on X (live log + post URL).
- E2 A post scheduled for T is published between T and T+2 min on production (audit timestamps).
- E3 A bot is refused for any account outside its scope on every tool, by account, post or media id (I2 + one live call).
- E4 Policy (cap, gap, quiet hours, link, disclosure, pause) holds at create and at publish, including under concurrency (unit + R10).
- E5 No part is ever sent twice (I1, R1, R4 with negative controls).
- E6 Token refresh is race-free (R3 with its negative control).
- E7 Unknown outcomes are reconciled and never re-sent without a human confirmation (I4, R2).
- E8 Dashboard shows backlog, calendar, metrics, costs, audit; the kill switch stops an account by the next tick; CSRF and login throttling hold (integration + live).
- E9 Metrics are collected on the decay schedule and returned by `get_account_metrics` / `compare_posts`.
- E10 ruff, pyright strict, import-linter clean; coverage ≥ 90% line and branch; no surviving mutants in entities, use_cases, interface_adapters.
- E11 GrokChat cannot read or write any MuseChat table (I7 locally; one check on production with the `grokchat_app` role).

## 9. Follow-ups (not v0)

Video (chunked upload, longer processing); Premium long posts; Infisical; per-personality multi-account; a second-opinion content check before publish; alerting (email when an account goes DISCONNECTED or a post is NOT_FOUND).

## 10. Round 1 findings → changes

Architecture: B1 → §3.1 Actor/BotScope/authorize, §3.3 preamble, §3.4 tool addressing, R7. B2 → §3.1.1 lease/reaper rows, §3.2 PostWriter/PostClaimer, §3.5 claim SQL. B3 → §3.3 #1 idempotency + publish_now budget, I8. M1 → §3 framework-free controllers. M2 → SENDING before send, R4. M3 → per-part state, §3.1.1 table, `map_x_outcome`, `missed`. M4 → XOwnTimelineReader, normalised match, NOT_FOUND + confirmation. M5 → per-account serialisation (rev 3: `AccountLease`), cap counts in-flight, R10. M6 → X ports take account_id, AccessTokenProvider, XAuthRevoked, scopes. M7 → OAuthStateStore, session-bound callback, x_user_id check, R11. M8 → CSRF, cookie flags, LoginThrottle, R12. M9 → §3.6 schema/role/RLS. M10 → §1.1 mcp row, §3.5 lifespan. M11 → §3.3 #3 URL fetch + signed upload. M12 → get_personality/get_policy tools. M13 → §5 deps and records. M14 → R1/R3/R10 deterministic tests with negative controls. M15 → §7 order, spike on production, pasted local checks. m1 → PublishPost split. m2 → StagedMedia vs XMediaId. m3 → JobLease. m4 → Provenance. m5 → publish_at validation. m6 → mutmut scope. m7 → MultiFernet. m8 → token entropy, compare_digest, allowed hosts. m9 → app-scope 429 stops tick. m10 → I6 scope. m11 → bot config fail-closed.

Feasibility: F1 → §1.1 mcp row, §3.5. F2 → §2, `is_app_owner`, reconcile query. F3 → media rows, §3.3 #3, `validate_part`. F4 → §3.6 cron on production, spike on production. F5 → B3 change. F6 → ToolRefusal/ToolError, pydantic presenters. F7 → OAuth row, scopes. F8 → deps, import-linter list. F9 → cost `UNKNOWN` for media. F10 → U13, URL priced $0.20 until U4. F11 → §1.1 Supabase row, psycopg settings, U12.

## 11. Round 2 findings → changes

Architecture: N1 (transaction boundary) → `PublishGate.reserve_part` (§3.2; replaced in rev 4 by the `PublishTransactions` unit of work, §12), ThreadSender sends outside any transaction (§3.3 #4), cap counts SENDING (§3.1), R4 checks SENDING is visible from a second connection. N2 (shared connection) → `psycopg_pool`, one connection per unit of work, R10 single-instance test. N3 (claim SQL) → CTE claim (§3.5), ≤ 1 per account test (R1). N4 (lease liveness) → LEASE 180 s > maxDuration 120 s, renewed per part, budgeted claims, reaper rows, stop on VersionConflict (§3.1.1). N5 (partly sent posts) → `RESUMING` lifecycle, guards on edit/cancel/missed, `resume_at`, rows for app 429 and gate refusals (§3.1.1). N6 (idempotency race) → unique index, `Duplicate(existing)`, `request_hash`, R14. N7 (service key) → banned; `bytea` fallback; startup check (§1.2 U11, §3.6).

Feasibility: N1 (RLS blocks own role) → one policy per table for `grokchat_app`, suites run as `grokchat_app`, migration test (§3.6, §6). N2 (advisory lock vs SENDING) → durable `AccountLease` row, advisory locks removed (§3.2, §3.5). N3 (lease < maxDuration, stranded posts) → same as architecture N4. Barrier tests split into exactly-once and non-blocking, each with its own control (R1). Session advisory locks banned. I7 audits functions too. `allowed_hosts` lists every production host. F5 minor → budget checks only before a claim or part; derived status returned. U13 resolved (vendor the archived MIT port).

## 12. Round 3 findings → changes

Architecture: P1 (voluntary stop) → "worker yields" row in §3.1.1, ticks yield unstarted claims, inline budget yields, R15. P2 (policy in the driver) → `PublishTransactions` unit-of-work port with no policy; the use case calls `check_publishable` (§3.2, §3.3 #4). P3 (control can't fail; lost lease) → statement order (renew → load → decide → mark), `LeaseLost` row, R10 controls that break serialisation, stale-holder test. P4 (key check gap; storage port) → `sb_secret_` and non-anon JWT refused, `SignedUploadIssuer` split out, direct-POST mode, U11 decided in the spike.

Feasibility (converged; minors): lease-not-acquired row → P1 row; release SQL shown and holder-scoped; exact host names in `allowed_hosts`; TLD refresh + test; pool `open=True` in the lifespan; claim ordering commented.
