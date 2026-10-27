# Contributing to GrokChat

GrokChat follows the team's conventions in `Agents/CLAUDE.md` (branches, Plane tickets, Clean Architecture and SOLID, tests). This file covers what is specific to this repo. The plan is [`docs/PLAN.md`](docs/PLAN.md).

## Setup

Node 26.10.0 or newer and npm 11.19.1 or newer (`engines` in `package.json`; `.npmrc` sets `engine-strict`).

```sh
npm ci
git config core.hooksPath .githooks
```

Dependency install scripts are blocked by npm and denied in `package.json` (`allowScripts`); see `docs/decisions/2026-10-27-tooling-and-gates.md`.

## Run the full local check

One line runs every gate. It must be green before every PR, and until CI runs (ASTERION-42) its output is pasted into the PR:

```sh
npm run check
```

It runs, in order, and stops at the first failure:

| Script                 | Gate                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`    | `tsc` strict over three projects: `tsconfig.inner.json` (entities, use cases, interface adapters; `"types": []`, `lib: ["ES2023"]`), `tsconfig.json` (frameworks, `main.ts`, workerd tests; workers-types) and `tsconfig.node.json` (plain-Node tests and tool configs) |
| `npm run lint`         | ESLint: typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`, no triple-slash references in the inner layers, no mutable module state in entities, functions ≤ 40 lines, modules ≤ 400 lines                                                                  |
| `npm run format:check` | Prettier                                                                                                                                                                                                                                                                |
| `npm run depcruise`    | dependency-cruiser: layers point inward; `@modelcontextprotocol/sdk`, `hono` and `cloudflare:*` only in `frameworks/`; `zod` only in `interface_adapters/schemas/` and `frameworks/`; no `utils`, `helpers`, `common` or `misc` modules; no cycles or orphans           |
| `npm test`             | Vitest: `unit` and `architecture` in plain Node, `workers` in workerd with local D1, Durable Object and R2 bindings; istanbul coverage over `src/`, lines ≥ 90% **and** branches ≥ 90%, each checked on its own                                                         |
| `npm run mutation`     | Stryker on `src/entities`, `src/use_cases`, `src/interface_adapters` under plain Node; any surviving mutant fails (break threshold 100)                                                                                                                                 |
| `npm run licenses`     | Runtime licences against a strict allowlist (with the `twitter-text` override in `licence-clarifications.json`), then every installed package against the wider development list                                                                                        |
| `npm run audit`        | `npm audit --omit=dev`                                                                                                                                                                                                                                                  |

Run a single project while working: `npx vitest run --project unit` (or `architecture`, `workers`). `npm run mutate:changed` runs Stryker only on the files of its mutate set that differ from `origin/staging` (set `MUTATE_BASE` to compare with another ref); the full `npm run mutation` stays in `npm run check`. `npm run format` rewrites files with Prettier.

## Where code goes

```text
src/entities/            readonly types and pure functions
src/use_cases/<name>/    input_boundary, interactor, output_boundary, output_data (and input_data when there is input)
src/use_cases/ports/     data-access interfaces, entity types only
src/interface_adapters/  controllers, presenters, view models; zod schemas in schemas/
src/frameworks/          Workers entry pieces, Durable Object, D1/R2/X drivers, Hono, MCP SDK
src/frameworks/memory/   in-memory stubs, one per port (tests, and the stub backend)
src/main.ts              composition root
tests/{architecture,contract,invariants,unit,integration}/
```

`tests/contract/*.contract.ts` holds one suite per port; `tests/contract/memory_stubs.test.ts` runs them against the stubs, and each real driver joins it. `tests/architecture/fixtures/` holds deliberate violations that the architecture tests feed to each gate; they are excluded from the normal runs.

## Dependencies

No new dependency without a decision record in `docs/decisions/` (`Agents/CLAUDE.md` §7.1). Install with exact versions (`.npmrc` sets `save-exact`) and commit `package-lock.json`.

## Secrets

Never commit, print or log a secret. Production secrets are Worker secrets (`wrangler secret put <NAME>`). Locally, copy `.dev.vars.example` to `.dev.vars` (gitignored) for `wrangler dev`.

## Changelog

Every PR adds an entry under `[Unreleased]` in `CHANGELOG.md`: what changed, the ticket, and why.
