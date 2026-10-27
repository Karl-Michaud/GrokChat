# 2026-10-27 — Runtime dependency: hono

## Context

The Worker serves `/health`, `/mcp` and `/mcp/` (bots), `/dashboard/*` and `/oauth/x/*` (admin session) (plan §3). It needs a router, request helpers, and server-rendered HTML for the dashboard, inside the Workers bundle and CPU budget.

## Decision

**hono 4.13.14** (MIT, no dependencies). It is built for Web-standard runtimes including Workers, adds little to the bundle, and the MCP SDK already depends on it (`^4.11.4`), so it costs nothing extra. It is used **only under `src/frameworks/`**; routes turn requests into plain values and call framework-free controllers. dependency-cruiser's `vendors-only-in-frameworks` rule fails the build otherwise.

Added in PR 1: `src/frameworks/http/app.ts` serves `/health`.

## Consequences

- Replacing it touches `src/frameworks/http/` only.
- The dashboard's HTML comes from Hono's JSX or `html` helper in frameworks; view models stay framework-free in interface_adapters.
