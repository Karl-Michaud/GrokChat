# 2026-10-27 — Runtime dependency: twitter-text

## Context

X counts post length in weighted characters (280, NFC, emoji and CJK count 2, every URL 23) and links bare domains, which changes both validity and price (plan §1.1, U4, U13). `validatePart` and `containsUrl` must match X exactly.

## Decision

**twitter-text 3.1.0**, X's own counting library (2020-03-31). It passes the upstream conformance YAML: v3 counter 22/22, v2 20/20, directional 2/2, URL extraction 91/91, with indices 10/10; it detects bare domains and new gTLDs; it runs in workerd, at ~36 ms on a cold isolate and 1–3 ms warm (`docs/spikes/reviews/feasibility-r5/u13/`, `docs/spikes/spike-2/`).

- **Licence:** its `package.json` has no `license` field, but it ships an Apache-2.0 `LICENSE`. `licence-clarifications.json` overrides it to Apache-2.0 for exactly 3.1.0, pinned to the file's SHA-256 (`08a9320a…`), so a new version or a changed licence file fails `npm run licenses`.
- **Dependencies:** `@babel/runtime`, `core-js@2`, `punycode@1.4.1` and `twemoji-parser`, all MIT. `core-js`'s banner-only install script is denied.
- **Where:** it is pure (no I/O), so it is allowed in **`src/entities/`** (the content rules live there, plan §3.1) and in `src/frameworks/`, and nowhere else (dependency-cruiser `inner-layers-no-npm-packages` and `twitter-text-only-in-entities`).

Installed in PR 1, so the licence override is a live gate from the start; first imported in PR 2.

## Consequences

- It is unmaintained since 2020. If X changes its counting rules, the conformance suite (PR 2) is the alarm; a fork or a reimplementation would get its own record.
- Its cold-start cost is part of the CPU budget (U19, E11).
