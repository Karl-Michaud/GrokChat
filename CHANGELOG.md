# Changelog

This file records every notable change to GrokChat: what changed, and why. It follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions will follow [Semantic Versioning](https://semver.org/) from the first release to `main`.

## [Unreleased]

### Added

- **The TypeScript skeleton on Cloudflare Workers, with every gate** (GROKCHAT-6, plan §5 and §7.1 PR 1):
  - an npm package with exact versions and a committed `package-lock.json`; `engines` Node ≥ 26.10.0, npm ≥ 11.19.1; dependency install scripts denied;
  - three TypeScript projects: the inner layers with no ambient types (`"types": []`, `lib: ["ES2023"]`), the Workers project, and a plain-Node project for tests and configs;
  - ESLint (typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`, the triple-slash ban in the inner layers, no mutable module state in entities, 40-line functions, 400-line modules) and Prettier;
  - dependency-cruiser rules for the dependency rule, the vendor bans (MCP SDK, Hono, `cloudflare:*`, zod, twitter-text), grab-bag modules, cycles, orphans and unresolvable imports;
  - Vitest 5 in plain Node and in workerd (`@cloudflare/vitest-plugin` with local D1, Durable Object and R2), istanbul thresholds lines 90 and branches 90, each separate; Stryker on the pure layers with break threshold 100; licence allowlists with the `twitter-text` override; `npm audit --omit=dev`; `npm run check` runs them all;
  - `wrangler.jsonc` declaring the `DB` (D1 `grokchat`), `ACCOUNT` (`AccountPublisher`, `new_sqlite_classes`) and `MEDIA` (R2 `grokchat-media`) bindings, compatibility date `2026-10-23`; nothing created or deployed;
  - `src/main.ts` exporting `fetch` (Hono, `GET /health` through a use case, presenter and view model), an empty `scheduled`, and the `AccountPublisher` Durable Object class;
  - architecture tests that feed each gate a deliberate violation: Workers types in a use case must fail `tsc`, triple-slash references must fail ESLint, and every dependency-cruiser rule must fire;
  - decision records: the TypeScript exception, Cloudflare-only hosting, tooling and gates, and one per runtime dependency (`@modelcontextprotocol/sdk`, zod, hono, htmx, twitter-text); `CONTRIBUTING.md`; `.dev.vars.example` (names only).
  - **Why:** every later PR lands on these gates, so they exist and are proven to fail on a violation before any product code (`Agents/CLAUDE.md` §7.1; plan §7.1).
