# U9 spike results (2026-10-27)

Setup: `srv.py` (mcp 2.3.0, stateless + JSON, bearer verifier, FastAPI lifespan, transport security
allowing only the tunnel host) on 127.0.0.1:8765, exposed by a cloudflared quick tunnel. `xai_probe.py`
called `POST https://api.x.ai/v1/responses` (model `grok-4.7`) with the server as a `type: "mcp"` tool.
Raw responses (bot token scrubbed): `logs/xai_*.json`; server log: `logs/requests.jsonl`.

| Question | Result |
|---|---|
| Does `authorization` need the `Bearer ` prefix? | No. A bare token and `Bearer <token>` both arrive as exactly `Bearer <token>` (len 50 = 7 + 43). |
| `/mcp/` vs `/mcp` | `/mcp/` works. `/mcp` gets our 307 → xAI does **not** follow it: HTTP 400 "Failed to connect to MCP server". |
| Session pattern | Per listing and per call, xAI opens a new session: `initialize` → `notifications/initialized` (202) → `tools/list` or `tools/call`. `Mcp-Protocol-Version: 2025-11-25`. No session id needed (stateless works). Client: `rmcp` (Rust) over reqwest. |
| `allowed_tools` | Filtered by xAI, not by the server: our `tools/list` returned 3 tools, the model saw only the 2 allowed. Tool names are shown to the model as `grokchat___<tool>`. |
| Wrong token | Our 401 makes the **whole** Responses call fail: HTTP 400 "Authentication failed … Auth required, when send initialize request". |
| Resources | Never read: no `resources/list` or `resources/read`; the model answered "NO RESOURCE ACCESS". |
| Tool-call timeout | Hard **60 s**: 10 s and 30 s completed; 60 s and 120 s failed with "MCP tool call … timed out after 60s" (the Responses call itself still returns 200 with the `mcp_call` marked `failed`). |
| Work after a timeout | The server kept running the abandoned call: the 120 s handler was still running at 86 s, 26 s after xAI gave up (the server was then stopped, so completion was not observed). |
| Latency | ≈ 3–4 s end to end for one echo call (model + 3 MCP requests). |
| Host header through cloudflared | Preserved (`<name>.trycloudflare.com`), so `allowed_hosts` with the public host works. |

Not tested here (needs Vercel): the same app on Vercel's Python runtime (lifespan, 4.5 MB body limit, cold start).
