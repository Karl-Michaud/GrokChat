import type { MediaUrlRefusal } from "../../entities/media/media_url";

export type FetchRefusal = MediaUrlRefusal | "too_large" | "bad_type" | "unreachable";

export type FetchResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly contentType: string }
  | { readonly ok: false; readonly reason: FetchRefusal };

/**
 * Fetches a bot-supplied https URL. The driver applies `checkMediaUrl` to the URL and to every
 * redirect hop (`redirect: "manual"`) and enforces the size cap while reading (plan §3.5, U18).
 */
export interface MediaFetcher {
  fetch(url: string, maxBytes: number, allowedTypes: readonly string[]): Promise<FetchResult>;
}
