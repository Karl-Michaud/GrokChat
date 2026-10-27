# 2026-10-27 — Runtime dependency: htmx (vendored)

## Context

The dashboard (PR 7) is server-rendered HTML with a few interactive pieces: approve, reject, pause, the kill switch, paging the backlog. A client framework would add a build step and a second codebase.

## Decision

**htmx 2.0.11** (`htmx.org`, 0BSD), **vendored**: the minified file is committed and served by the Worker with a SHA-384 Subresource Integrity hash pinned in the page (plan §3.5). It is not loaded from a CDN, so the dashboard has no third-party origin. It is not an npm runtime import of any TypeScript module.

Vendored in PR 7 (GROKCHAT-12): `src/frameworks/web/static/htmx-2.0.11.min.js.txt`, the unmodified `dist/htmx.min.js` of the npm tarball (its sha512 integrity checked), with its 0BSD licence beside it. Wrangler bundles it as a Text module, and a workerd test recomputes the SHA-384 the page pins.

## Consequences

- Upgrading htmx is replacing one file and its hash, recorded in the CHANGELOG.
- Every non-GET htmx request carries the session's CSRF token and passes the exact Origin check (plan §3.5, m4).
