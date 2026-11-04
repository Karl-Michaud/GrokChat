# Cloudflare + TypeScript spike results (2026-10-27)

Worker `grokchat-spike-ts` on the owner's **free** Cloudflare account (`47e41396…`), deployed with
`wrangler deploy` from `src/index.ts`: `@modelcontextprotocol/sdk` 1.32.2 with
`WebStandardStreamableHTTPServerTransport` (stateless, JSON responses), bearer auth via
`crypto.subtle.timingSafeEqual`, D1 (auto-provisioned), a SQLite-backed Durable Object per account,
a `* * * * *` cron trigger, WebCrypto. CPU numbers from `wrangler tail` (`logs/tail.jsonl`);
concurrency checks in `concurrency.py`; Grok calls via `../spike-u9/xai_probe.py`.

| Check | Result |
|---|---|
| Startup | Worker startup 45 ms (Python Worker: 6,048 ms); bundle 1.4 MB, 242 KB gzipped. |
| Auth | Correct bearer → 200; wrong or missing → 401. |
| `/mcp` and `/mcp/` | Both 200, no redirect. |
| **CPU on the free plan** | 54 MCP requests after warm-up: p50 6–7 ms, p90 13–16 ms, max 35 ms; 13 of 54 over the nominal 10 ms; **all outcomes `ok`, no 1102**. Cold MCP calls 27–38 ms, also `ok`. D1 calls p50 ≈ 2 ms (max 7), Durable Object calls 1 ms, cron runs 1–2 ms. |
| Grok → Worker | `echo` 2.2–2.5 s; `count_posts` (D1) 2.6 s → "posts: 50"; `publish` (Durable Object) 3.0 s → `{"sent":true,"count":1}`. |
| D1 claim | 20 concurrent claimers over 50 rows: 50 claims, all distinct. Same with the outer guard removed: D1 runs each statement atomically (single writer), so one conditional `UPDATE … RETURNING` is enough; keep the guard anyway. |
| **Durable Object serialisation** | Cap 3, 10 concurrent publishes, each awaiting an outbound `fetch` between check and write: with `blockConcurrencyWhile` → exactly 3 sent; **naive → 5 sent (cap broken)**. A DO does not serialise across `await` by default. |
| Cron | Fired every minute from 16:00:12Z (≈ 5.5 min after deploy: propagation), wrote to D1 each time, `ok`, 1–2 ms CPU. |
| WebCrypto | AES-GCM round trip OK (token encryption at rest). |

Docs facts gathered alongside:
- `blockConcurrencyWhile` has a **30 s timeout**, after which the object is reset. So the real design serialises with an async lock inside the DO, plus the SENDING mark persisted before the X call, rather than holding `blockConcurrencyWhile` across the X call.
- DO free plan: SQLite-backed only; 100k requests/day, 13,000 GB-s/day, 5M rows read/day, 100k rows written/day, 5 GB.
- D1 free: 10 databases, 500 MB each, 5 GB per account, **50 queries per invocation**, 30 s per query.
- Workers free: 100k requests/day, 50 subrequests per invocation, 5 cron triggers.

Caveat: the free plan's nominal limit is 10 ms CPU per invocation and our p90 is above it. Cloudflare served every over-limit request in this test, but how it treats sustained over-limit use is not documented here. The real build keeps the MCP handler lean, and the fallback is Workers Paid ($5/month, 30 s CPU).
