import HTMX_SOURCE from "./static/htmx-2.0.11.min.js.txt";

/**
 * htmx 2.0.11 (0BSD, `static/htmx-LICENSE.txt`), vendored: the unmodified `dist/htmx.min.js` of
 * the npm tarball (sha512 integrity checked when vendored), served by the Worker itself and pinned
 * by its SHA-384 Subresource Integrity hash (plan §3.5, docs/decisions/2026-10-27-dependency-htmx.md).
 * Upgrading is replacing the file, this hash and the path, recorded in the CHANGELOG.
 */
export const HTMX = {
  path: "/dashboard/static/htmx-2.0.11.min.js",
  integrity: "sha384-2OatzQy1H+Zd/IIrjr1TcuDGqLXeHhbooAyJY1KdQMKnr4LZ22k31GBLdYKHmVjg",
  source: HTMX_SOURCE,
} as const;
