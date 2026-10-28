import APP_CSS_SOURCE from "./static/app.css.txt";
import APP_JS_SOURCE from "./static/app.js.txt";
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

/** FNV-1a, 32 bits, as 8 hex digits: a content fingerprint for cache-busting, not security. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface StaticAsset {
  readonly path: string;
  readonly contentType: string;
  readonly source: string;
}

/**
 * The dashboard's own stylesheet and script (GROKCHAT-15): same-origin files under a path that
 * carries their fingerprint, so a deploy changes the URL and every browser may cache them for a
 * year. The CSP allows only same-origin scripts and styles, so nothing inline is ever needed.
 */
export const APP_CSS: StaticAsset = {
  path: `/dashboard/static/app.${fingerprint(APP_CSS_SOURCE)}.css`,
  contentType: "text/css; charset=utf-8",
  source: APP_CSS_SOURCE,
};

export const APP_JS: StaticAsset = {
  path: `/dashboard/static/app.${fingerprint(APP_JS_SOURCE)}.js`,
  contentType: "text/javascript; charset=utf-8",
  source: APP_JS_SOURCE,
};
