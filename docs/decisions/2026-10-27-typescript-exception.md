# 2026-10-27 — TypeScript, an exception to the team's Python standard

## Context

`Agents/CLAUDE.md` §7.2 sets the stack for every product repo: Python 3.12, `uv`, `pytest`, `pydantic` v2. GrokChat runs on Cloudflare Workers on the free plan ([hosting record](2026-10-27-cloudflare-only-hosting.md)).

Python Workers were tried first and failed the free plan: the first MCP request returned error `1102` (CPU limit exceeded) (`docs/spikes/spike-cf/`). The same MCP server in TypeScript passed: p50 6–7 ms CPU, no `1102` across the run, and Grok → Worker calls of 2.2–3.0 s including D1 and Durable Object tools (`docs/spikes/spike-cf-ts/RESULTS.md`; plan §1.1).

## Decision

GrokChat's product code is **TypeScript (strict)**, run by the Workers runtime. This is a deliberate exception to §7.2 for this repo only. Everything else in `Agents/CLAUDE.md` §7.1 applies in full: Clean Architecture in the four layers, SOLID, at least 90% line **and** branch coverage, property tests, mutation testing, no grab-bag modules, no function over 40 lines and no module over 400.

Each Python gate has a TypeScript equivalent (plan §5), and `npm run check` runs all of them:

| Asterion gate                        | GrokChat                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| import-linter layers and vendor bans | dependency-cruiser (`.dependency-cruiser.cjs`)                                                                                                  |
| pyright strict                       | `tsc` strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, over three projects (inner layers with no ambient types, Workers, Node) |
| ruff                                 | ESLint (typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`) and Prettier                                                            |
| pytest + pytest-cov                  | Vitest 5 (plain Node and `@cloudflare/vitest-plugin`), istanbul thresholds lines 90 and branches 90, each separate                              |
| Hypothesis                           | fast-check                                                                                                                                      |
| mutmut                               | Stryker, break threshold 100, on the pure layers under plain Node                                                                               |
| pip-licenses, pip-audit              | license-checker-rseidelsohn, `npm audit --omit=dev`                                                                                             |

The tool versions and why each was chosen are in [the tooling record](2026-10-27-tooling-and-gates.md).

## Consequences

- Pydantic's role at the boundary is taken by zod ([record](2026-10-27-dependency-zod.md)); entities are `readonly` types and pure functions.
- The team's Python tooling (uv, prek) does not apply here; npm with an exact-version `package-lock.json` does.
- If Python Workers ever pass the free plan's CPU limit with the MCP SDK, this record is the place to revisit the choice. Nothing else depends on it.
