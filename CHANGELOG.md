# Changelog

This file records every notable change to GrokChat: what changed, and why. It follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions will follow [Semantic Versioning](https://semver.org/) from the first release to `main`.

## [Unreleased]

### Added

- **Entities, ports and every use case, on in-memory stubs** (GROKCHAT-7, plan §3.1–§3.3 and §7.1 PR 2):
  - entities: identity and `authorize`; accounts and the posting policy; `validatePart` and URL detection through twitter-text 3.1.0 in `entities/text`, checked against the upstream conformance YAML (U13); the post model with the §3.1.1 transition table, `derivedStatus` and `missed`; `checkPublishable` and `nextAllowedAt` across time zones and DST; `mapXOutcome` (401/403 → needs reconnect; app-scope 429 as its own outcome); `refreshOutcome` with the stored-token check (U1, U14); `estimateCost` (scheme URL $0.20, bare domain $0.015, U4); `metricsDue`; `redact`; the R2 quota and cleanup policies; the media URL (SSRF) policy; `Budget` with the shared 1,000 Cloudflare-service pool and 50 external fetches (U16);
  - every port of §3.2 with entity types only, plus `TokenStore`, `XTokenRefresher`, `SingleFlight`, `MediaUsageRepository`, `ContentHasher` and `PkceGenerator`; an in-memory stub for each in `src/frameworks/memory/` (the DO's promise-chain mutex, a fake X with scripted outcomes, U1's single-use token rotation);
  - use cases, one folder each: create (idempotency, the inline 10 s publish), edit, cancel, approve, reject, reschedule, media staging from a URL and by upload, the three cron ticks (fan-out ceiling 200), delete, the read side, and the admin and OAuth connect flows; run services: `PublishPost` (recovery under the publish lock, then token first, worst-case budget, ReservePart, create, one guarded commit), the refreshing token provider, reconcile, metrics, the X gateway, media cleanup;
  - tests: the transition table exhaustively, fast-check properties (cap, gap, quiet hours across zones and DST, `missed`, `metricsDue`, `estimateCost`, `redact`), every interactor, invariants I1–I9 with a no-lock negative control and DO-reset injection, a contract suite per stateful port (run in workerd), and a compiler-API scan of port signatures; Stryker 100% on the pure layers;
  - `yaml` 2.9.1 as a development dependency, to read the upstream conformance files (decision record).
  - review fixes: a first part held back by the gate or by X's `retryAt` stays SCHEDULED with that not-before time, and `missed` counts from max(`publishAt`, not-before) + grace, so queued posts are no longer lost and a 429 is not retried every tick; reconcile compares text with every URL masked and trailing links dropped, so parts with URLs, bare domains or media match X's t.co-rewritten `text`; fast-check properties for `missed`;
  - **Why:** the domain and its rules are proved on stubs before any driver exists, so PR 3 (D1 and the Durable Object) and PR 4 (X) only add drivers that must pass the same contracts (plan §7.1).
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
