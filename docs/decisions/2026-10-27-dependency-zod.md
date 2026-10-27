# 2026-10-27 — Runtime dependency: zod

## Context

`Agents/CLAUDE.md` §7.2 requires validation at the boundary that fails loudly; in the Python repos that is pydantic. GrokChat validates MCP tool inputs, HTTP form and query input, and env/secret JSON (for example `GROKCHAT_BOT_CLIENTS`).

## Decision

**zod 4.6.7** (MIT, no dependencies). The MCP SDK takes zod schemas for tool inputs, so one validator serves both MCP and HTTP. It is allowed **only in `src/interface_adapters/schemas/` and `src/frameworks/`**; entities and use cases never see it. dependency-cruiser's `zod-only-at-boundaries` rule enforces it.

Installed in PR 5, the first PR with a boundary schema.

## Consequences

- Entities are plain `readonly` types; schemas map onto them at the boundary.
- `@cloudflare/vitest-plugin` already pulls zod 4.6.6 for its own use; that copy is a development dependency and is not what the product imports.
