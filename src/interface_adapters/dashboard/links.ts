import type { XPostId } from "../../entities/identity/ids";
import type { PartView } from "../../use_cases/views/post_view";

/** A dashboard URL: the path and the query parameters that have a value, in the order given. */
export function href(path: string, query: Readonly<Record<string, string | null>> = {}): string {
  const params = Object.entries(query).flatMap(([name, value]) =>
    value === null || value === ""
      ? []
      : [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`],
  );
  return params.length === 0 ? path : `${path}?${params.join("&")}`;
}

/** The post on X; `handle` without its `@`, or null when the account is unknown. */
export function xPostUrl(handle: string | null, id: XPostId): string {
  const path = handle === null ? "i/web" : encodeURIComponent(handle);
  return `https://x.com/${path}/status/${encodeURIComponent(id)}`;
}

export function postHref(id: string): string {
  return `/dashboard/posts/${encodeURIComponent(id)}`;
}

/** The part on X while it is there: sent, not deleted. */
export function liveUrl(handle: string | null, part: PartView): string | null {
  return part.state === "SENT" && part.xPostId !== null ? xPostUrl(handle, part.xPostId) : null;
}
