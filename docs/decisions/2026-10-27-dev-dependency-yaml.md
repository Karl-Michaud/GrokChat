# 2026-10-27 — Development dependency: yaml

## Context

U13 requires twitter-text to pass the upstream conformance suite, and the plan keeps that suite as a test fixture (plan §6, `tests/unit/`). Upstream ships it as YAML (`conformance/validate.yml`, `conformance/extract.yml`, twitter-text tag v3.1.0, commit `65e7e00`). Node has no YAML parser, and converting the files to JSON by hand would make the fixture something other than the upstream file.

## Decision

**yaml 2.9.1** (eemeli/yaml, ISC, no dependencies, published 2026-09-11), as a **development dependency only**, used by `tests/unit/entities/text/post_text.test.ts` to read the two upstream files.

- The fixtures are committed byte for byte, excluded from Prettier, and their SHA-256 is asserted by the test, so an edited fixture fails the build.
- It is never imported from `src/` (the inner layers import no npm package other than the recorded ones; dependency-cruiser enforces it), and `npm run licenses:runtime` does not see it.

## Consequences

- One more package in the development tree, inside the existing licence allowlist (ISC).
- Replacing twitter-text later (its own record's consequence) keeps the same suite and the same parser.
