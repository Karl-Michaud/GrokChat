# 2026-10-27 — Runtime dependency: @modelcontextprotocol/sdk

## Context

Grok bots reach GrokChat through xAI's remote MCP tool (plan §1.1, U9): each listing and call is a fresh `initialize → initialized → request` over streamable HTTP (protocol `2025-11-25`), no redirects are followed, and tools time out at 60 s.

## Decision

**@modelcontextprotocol/sdk 1.32.2** (MIT), the official TypeScript SDK. Its `WebStandardStreamableHTTPServerTransport` in stateless JSON mode (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) was proved on Workers: `/mcp` and `/mcp/` served, Grok → Worker 2.2–3.0 s, MCP requests p50 6–7 ms CPU (`docs/spikes/spike-cf-ts/RESULTS.md`).

It is used **only under `src/frameworks/`**: a new `McpServer` and transport per request, tools registered from a static table, and tool shims that call framework-free controllers. dependency-cruiser's `vendors-only-in-frameworks` rule enforces it.

Installed in PR 5 (the MCP server), which first imports it.

## Consequences

- The SDK pulls Node-oriented packages (express, cors, `@hono/node-server`) that the Worker bundle does not import; bundle size is checked when PR 5 lands (the spike measured 242 KB gzipped).
- An SDK upgrade is re-proved against xAI's client with the `/mcp` regression test (R6).
