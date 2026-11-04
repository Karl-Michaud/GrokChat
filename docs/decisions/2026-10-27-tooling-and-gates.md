# 2026-10-27 — Tooling and gates

## Context

`Agents/CLAUDE.md` §7.1 forbids a new dependency without a decision record and requires every gate from the first PR. GrokChat's gates are TypeScript equivalents of Asterion's ([TypeScript record](2026-10-27-typescript-exception.md)). The versions below were proven together in `docs/spikes/reviews/feasibility-r5/u20-plugin/` and `feasibility-r6/`, except where noted.

## Decision

### Development dependencies

Exact versions, pinned by `package-lock.json`. None ships in the Worker bundle.

| Package                                               | Version      | Licence           | Why                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typescript                                            | 6.0.3        | Apache-2.0        | `tsc --noEmit` over three projects. **Not 7.0.2**, which the spikes used: TypeScript 7's npm package ships the native compiler with no JavaScript compiler API, and typescript-eslint 8.72.1 requires `>=4.8.4 <6.1.0`. 6.0.3 is the newest release that typed linting, dependency-cruiser and the compiler-API scans (plan §6) can all load. |
| @cloudflare/workers-types                             | 5.20261027.1 | MIT OR Apache-2.0 | Workers globals, visible only to `frameworks/`, `main.ts` and the workerd tests.                                                                                                                                                                                                                                                              |
| @types/node                                           | 26.6.5       | MIT               | Node globals for the plain-Node tests and tool configs only.                                                                                                                                                                                                                                                                                  |
| wrangler                                              | 4.153.0      | MIT OR Apache-2.0 | `wrangler dev`, D1 migrations and deploys (PR 8). The version `@cloudflare/vitest-plugin` 1.4.8 pins.                                                                                                                                                                                                                                         |
| vitest                                                | 5.0.5        | MIT               | Test runner, three projects: `unit` and `architecture` in plain Node, `workers` in workerd.                                                                                                                                                                                                                                                   |
| @cloudflare/vitest-plugin                             | 1.4.8        | MIT               | Runs tests in workerd with real local D1, Durable Object and R2 bindings. The renamed successor of `vitest-pool-workers`, which fails with vitest 5 (plan §1.1).                                                                                                                                                                              |
| @vitest/coverage-istanbul                             | 5.0.5        | MIT               | Coverage across both runtimes; thresholds lines 90 and branches 90, each checked on its own.                                                                                                                                                                                                                                                  |
| eslint                                                | 10.13.0      | MIT               | Lint.                                                                                                                                                                                                                                                                                                                                         |
| @eslint/js                                            | 10.0.1       | MIT               | ESLint's recommended rules. Not in the spikes; it is ESLint's own package.                                                                                                                                                                                                                                                                    |
| typescript-eslint                                     | 8.72.1       | MIT               | `strictTypeChecked` + `stylisticTypeChecked`; the triple-slash ban in the inner layers.                                                                                                                                                                                                                                                       |
| prettier                                              | 3.9.10       | MIT               | Formatting.                                                                                                                                                                                                                                                                                                                                   |
| dependency-cruiser                                    | 18.7.0       | MIT               | The dependency rule and the vendor bans.                                                                                                                                                                                                                                                                                                      |
| @stryker-mutator/core, @stryker-mutator/vitest-runner | 10.1.1       | Apache-2.0        | Mutation testing on the pure layers under plain Node, break threshold 100.                                                                                                                                                                                                                                                                    |
| fast-check                                            | 4.10.2       | MIT               | Property tests. First users arrive in PR 2.                                                                                                                                                                                                                                                                                                   |
| license-checker-rseidelsohn                           | 5.0.1        | BSD-3-Clause      | Licence allowlists.                                                                                                                                                                                                                                                                                                                           |

### Install scripts

npm 11 blocks dependency install scripts unless `allowScripts` approves them. All four are denied in `package.json`: `esbuild`'s and `workerd`'s only verify the platform binary that npm already installs as an optional dependency (both run without them), `core-js`'s prints a banner, and `fsevents`'s builds an optional macOS watcher.

### Licences

`npm run licenses` runs two checks:

- **Runtime** (`--production`): only MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause and 0BSD. `twitter-text` 3.1.0 has no `license` field but ships an Apache-2.0 `LICENSE`; `licence-clarifications.json` overrides it to Apache-2.0, pinned to that exact version and to the file's SHA-256, and `--clarificationsMatchAll` fails a stale entry.
- **Everything installed**: the runtime list plus the licences of the development tools, which never ship: `MIT OR Apache-2.0`, BlueOak-1.0.0, CC0-1.0, CC-BY-3.0, CC-BY-4.0, `(MIT AND CC-BY-3.0)`, MPL-2.0 (lightningcss, through vite) and LGPL-3.0-or-later (`@img/sharp-libvips`, through miniflare). Any other licence fails.

### Audit

`npm audit --omit=dev` gates the runtime tree. On 2026-10-27 the full tree reports two moderate `qs` advisories through `typed-rest-client`, a development-only dependency of the Stryker toolchain; they do not ship and do not gate.

## Consequences

- `npm run check` is the one local gate (`CONTRIBUTING.md`). `.github/workflows/ci.yml` runs it once Actions billing is fixed (ASTERION-42).
- gitleaks (plan §5) is not installed on this machine and has no npm package; it joins with the CI workflow.
