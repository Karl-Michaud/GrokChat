# 2026-10-27 — Cloudflare only, on the free plan

## Context

Plan rev 4 hosted GrokChat on Vercel with Supabase (`docs/plan-history/grokchat-v0-plan-rev4-vercel-supabase.md`). On 2026-10-27 the owner chose **Cloudflare only, on the free plan**, and nothing in MuseChat's database (plan §0).

What the free plan gives, measured or documented (plan §1.1, §1.2):

- Workers: 100k requests a day, 10 ms nominal CPU per invocation (not enforced per request in short runs, U19), 50 external and 1,000 Cloudflare-service subrequests per invocation (U16), 5 cron triggers.
- D1: atomic single statements; `batch()` commits in order and rolls back entirely on a failure (U15, also on deployed D1).
- Durable Objects: SQLite-backed only; one object per account serialises publishing with an async mutex (proved, `docs/spikes/reviews/feasibility-r5/`).
- R2: enabled; 10 GB storage, 1M Class A and 10M Class B operations a month (U17).
- Cron Triggers call `scheduled()` directly, so no cron secret is needed.

## Decision

- One Worker, `grokchat`, on the owner's Cloudflare account, served at its `workers.dev` URL (a custom domain is a follow-up).
- Bindings, declared in `wrangler.jsonc` from PR 1: D1 `DB` (`grokchat`), Durable Object `ACCOUNT` (class `AccountPublisher`, `new_sqlite_classes`), R2 `MEDIA` (`grokchat-media`). PR 1 creates and deploys none of them; PR 8 does.
- `compatibility_date` is pinned to `2026-10-23`, the date of the workerd bundled with `@cloudflare/vitest-plugin` 1.4.8, so local tests and production run the same compatibility behaviour. A bump moves with the plugin.
- Secrets are Worker secrets (`wrangler secret put`); locally a gitignored `.dev.vars` (`.dev.vars.example` lists the names). Infisical later.
- Deploys are by hand (`wrangler deploy`) from a release on `main`; no Git integration.
- If the free plan's CPU limit is ever enforced against us, the fallback is Workers Paid ($5 a month; 30 s CPU).

## Consequences

- No Vercel, no Supabase, no Postgres: the state machine runs on D1 and one Durable Object per account (plan §3.5).
- Every limit above is a design input: `Budget` (plan §3.2), the 200-account fan-out ceiling, the R2 quota guard.
- The placeholder `database_id` in `wrangler.jsonc` must be replaced before any deploy; a deploy with it fails rather than writing anywhere.
