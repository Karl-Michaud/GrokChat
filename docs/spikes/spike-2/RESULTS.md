# GROKCHAT-5 Spike 2, part A: deployed Worker probes (2026-10-27)

Worker `grokchat-spike2` (wrangler 4.153.0, compat date 2026-10-27, `nodejs_compat`) on the owner's **Workers Free** account, with D1 `grokchat-spike2` and SQLite DO class `AccountPublisher`. No cron triggers. Every route required a random bearer token set with `wrangler secret put` (unauthenticated requests got 401). The token files were deleted after cleanup. Wrangler tail redacts `authorization`, and client IPs in the tail log were redacted.

CPU and outcome figures come from `npx wrangler tail --format json` (`evidence/tail.jsonl`, parsed by `evidence/parse_tail.py` into `evidence/tail-summary.json`): 1,556 events, **all `outcome: ok`**. The tail captured 1,515 of the roughly 2,417 DO invocations; sampling under load is a known tail behaviour. Source: `src/index.ts`.

## U16: per-invocation limits on deployed Free

| Question | Result | Evidence |
|---|---|---|
| Worker: 60 DO stub RPC calls (distinct ids) | 60/60 ok | `evidence/u16/worker-do-60.json` |
| Worker: 60 D1 queries | **60/60 ok.** The documented "50 D1 queries per invocation" is not what is enforced | `evidence/u16/worker-d1-60.json` |
| Worker: 60 fetches to example.com | 50 ok; #51–60 `Error: Too many subrequests by single Worker invocation.` | `evidence/u16/worker-fetch-60.json` |
| One DO invocation (called once): 60 D1 + 60 fetches | D1 60/60 ok; fetch 50 ok, #51–60 same "Too many subrequests" error | `evidence/u16/do-inside-60.json` |
| Do DO calls use the caller's 50 external? Worker: 45 DO calls, then 55 fetches | 45 DO calls ok, then fetches 1–50 ok and #51 failed. **DO calls do not count against the 50 external** | `evidence/u16/mixed-45do-55f.json` |
| Worker: 1,010 DO calls | 1,000 ok; #1001+ `Error: Too many API requests by single Worker invocation.` | `evidence/u16/worker-do-1010.json` |
| Worker: 1,010 D1 queries | 1,000 ok; #1001+ the same "Too many API requests" error | `evidence/u16/worker-d1-1010.json` |
| Do they share one pool? Worker: 600 DO calls, then 600 D1 | 600 DO ok; D1 ok to #400, failed from #401. **DO calls and D1 queries share the caller's 1,000 Cloudflare-service pool** | `evidence/u16/mixed-600do-600d1.json` |
| Fan-out: 45 DOs in parallel × (10 D1 + 5 fetch) | 450/450 D1, 225/225 fetch, 0 call errors, 2.4 s wall, Worker CPU 17 ms | `evidence/u16/fanout-45x10x5.json` |
| Fan-out: 200 DOs | 2,000/2,000 D1, 1,000/1,000 fetch, 6.4 s, Worker CPU 51 ms | `evidence/u16/fanout-200x10x5.json` |
| Fan-out: 500 DOs | 5,000/5,000 D1, 2,500/2,500 fetch, 15.3 s, Worker CPU 201 ms, outcome ok | `evidence/u16/fanout-500x10x5.json` |

**Conclusion.**

- A DO call counts as one Cloudflare-service subrequest of the caller. The 1,000 pool is shared with D1 queries, and DO calls do not count against the caller's 50 external fetches.
- Each DO invocation has its own budgets: 50 external fetches, and D1 queries well above 50.
- The ceiling the data supports is about **(1,000 − the tick's own D1 queries) DO calls per tick invocation**, limited by the shared pool. 500 parallel DOs passed with no error.
- 40 is far below the limit. A ceiling of 500 has been measured. The binding constraint is now Worker CPU: 201 ms at 500, over the 10 ms nominal but not killed (see U19). Each DO still has to keep each part within 50 external fetches.
- The plan's "D1 50 queries per invocation" fact is wrong for deployed Free as measured: the effective limit is the shared pool of 1,000.

## U18: fetch to private and loopback addresses (3 s timeout, `redirect: manual`)

| URL | From the Worker | From a DO | Evidence |
|---|---|---|---|
| http://127.0.0.1/ | 403, `server: cloudflare`, body `error code: 1003` | same | `evidence/u18/worker.json`, `evidence/u18/do.json` |
| http://localhost/ | 403 / 1003 | same | same |
| http://10.0.0.1/ | 403 / 1003 | same | same |
| http://192.168.1.1/ | 403 / 1003 | same | same |
| http://169.254.169.254/ | 403 / 1003 | same | same |
| http://[::1]/ | 403 / 1003 | same | same |

**Conclusion.** Production never reaches a private or loopback target. Cloudflare's edge answers each one with error 1003 ("Direct IP access not allowed"), as an HTTP 403 response, not a thrown error, in about 1 ms. Local workerd does reach 127.0.0.1, so the code guard (allowlist, refuse literal IPs) stays. The driver must also treat a 403 / 1003 response as a refusal, not as content.

## U15: D1 batch atomicity on deployed D1

| Question | Result | Evidence |
|---|---|---|
| Batch of 4 inserts, 3rd violates UNIQUE | Throws `D1_ERROR: UNIQUE constraint failed: uq.v: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`; **0 rows** after | `evidence/u15/unique.json` |
| Raising `version_guard` batch, stale version 6 | Throws `D1_ERROR: NOT NULL constraint failed: version_guard.ok … SQLITE_CONSTRAINT_NOTNULL`; state unchanged (v 7, part `SENDING:-`, audit 0, cost 0, guard 0) | `evidence/u15/guard.json` |
| Same, current version but wrong lifecycle | Same NOT NULL error; nothing changed | `evidence/u15/guard.json` |
| Same, current version 7 / PUBLISHING | Committed: v 8, part `SENT:x-111`, audit 1, cost 1, version_guard 0 rows | `evidence/u15/guard.json` |

**Conclusion.** U15 holds on deployed D1, the same as locally.

## U19: CPU (tail `cpuTime`, ms)

| Route | Runs (cpuTime ms) | Within 10 ms? | Evidence |
|---|---|---|---|
| Baseline (auth + JSON) | 0, 0, 0, 2, 0 (and a 401 at 1) | yes | `evidence/u19/baseline-*.json` |
| twitter-text 3.1.0 `parseTweet` + `extractUrls`, 280 chars with 2 URLs (lazy `import()`) | cold (first after deploy) **36**; next 10: 35, 1, 37, 1, 20, 2, 3, 1, 2, 1 | warm yes (1–3 ms); **cold no (20–37 ms)**. The high "warm" runs are first hits on other isolates | `evidence/u19/tt-*.json` |
| PBKDF2-SHA-256, 100,000 iterations | 35, 34, 31 | **no** (about 3× nominal) | `evidence/u19/pbkdf2-100000-*.json` |
| PBKDF2 300,000 and 600,000 | **Not possible:** `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported` (cpu 0–2) | n/a | `evidence/u19/pbkdf2-{300000,600000}-*.json` |
| Large U16 routes, for reference | 373 (1,010 DO), 785 (1,010 D1), 797 (600 + 600), 201 (500 fan-out) | no | `evidence/tail-summary.json` |

**Conclusion.**

- **No request got 1101 or 1102**, including 797 ms of CPU on Free. The 10 ms nominal limit was not enforced per request in this short run. Sustained behaviour over a day of production traffic (E11) is still open.
- PBKDF2 is capped at **100,000 iterations** by workerd. Use 100,000, at about 33 ms CPU per login.
- twitter-text costs about 20–37 ms CPU on each isolate's first use, then 1–3 ms.

## Cleanup

`npx wrangler delete --name grokchat-spike2` reported "Successfully deleted". `npx wrangler d1 delete grokchat-spike2 -y` reported "Deleted". After that, `wrangler d1 list --json` returned `[]`, `wrangler deployments list --name grokchat-spike2` returned "This Worker does not exist on your account. [code: 10007]", and the hostname returns 404 (`evidence/cleanup.log`, `evidence/cleanup-verify.log`).
