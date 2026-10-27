# Vercel spike results (2026-10-27)

Throwaway project `grokchat-spike` in the personal Hobby team (`karl-michauds-projects`), deployed with
`vercel deploy --prod` from `app.py` (mcp 2.3.0, FastAPI lifespan, stateless JSON, bearer verifier,
`allowed_hosts` from `VERCEL_PROJECT_PRODUCTION_URL` + `VERCEL_URL`, `/mcp` served without a redirect).
Secrets as sensitive env vars (`SPIKE_TOKEN`, `CRON_SECRET`). Logs: `vercel-logs.jsonl`.

| Question | Result |
|---|---|
| Does the app run on Vercel's Python runtime? | Yes: runtime `python3.12`; the FastAPI lifespan runs on each instance boot (`lifespan start` ≈ 0.1–0.2 s after boot); no "Task group is not initialized". Each deploy pre-booted 3 instances. |
| Public vs protected | The production alias `grokchat-spike.vercel.app` is public (200). The per-deployment URL is behind Vercel Authentication (302). Bots must use the production domain. |
| Host check | `allowed_hosts` built from `VERCEL_PROJECT_PRODUCTION_URL` and `VERCEL_URL` admits the alias; a custom domain must be added explicitly. |
| `/mcp` without a slash | Served directly by rewriting the path before routing: `/mcp` and `/mcp/` both 200. Grok called `/mcp` successfully. |
| Grok → Vercel end to end | `bearer`, `noslash`, `allowed` all passed, ≈ 3–5 s each; consecutive calls hit the same warm instance. |
| Wrong token | 401. |
| Body limit | 4 MiB → 200; 4.4 MiB (4.6 MB) and up → 413 `FUNCTION_PAYLOAD_TOO_LARGE`. Consistent with the documented 4.5 MB. |
| Duration | `maxDuration: 120`: 70 s → 200; 130 s → 504 `FUNCTION_INVOCATION_TIMEOUT` at 120.1 s. |
| Cron | `vercel crons run /cron/ping` → `GET`, `User-Agent: vercel-cron/1.0`, `Authorization: Bearer <CRON_SECRET>` (secret matched). Cron requests arrive on the **deployment URL host**, not the alias. Hobby accepted the daily schedule. |

Not tested: a per-minute schedule (needs Pro; the docs say Hobby fails the deploy), real cold-start latency under load.
