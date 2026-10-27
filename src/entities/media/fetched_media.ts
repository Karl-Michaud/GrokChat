import { MAX_MEDIA_BYTES, sniffMedia, type SniffedMedia } from "../content/staged_media";
import { refuse, type Refused } from "../decision";

export type FetchedMediaRefusal = "too_large" | "bad_type";

export type FetchedMediaCheck =
  { readonly allowed: true; readonly media: SniffedMedia } | Refused<FetchedMediaRefusal>;

/**
 * Bytes fetched for `stage_media_from_url` (plan §3.5): within the caller's cap, of a kind read
 * from the magic bytes (never from a claimed content type) and among the allowed types, and within
 * X's limit for that kind (photo 5 MB, GIF 15 MB). Every `MediaFetcher` driver applies it.
 */
export function checkFetchedMedia(
  bytes: Uint8Array,
  maxBytes: number,
  allowedTypes: readonly string[],
): FetchedMediaCheck {
  if (bytes.length > maxBytes) {
    return refuse("too_large");
  }
  const sniffed = sniffMedia(bytes);
  if (sniffed === null || !allowedTypes.includes(sniffed.contentType)) {
    return refuse("bad_type");
  }
  if (bytes.length > MAX_MEDIA_BYTES[sniffed.kind]) {
    return refuse("too_large");
  }
  return { allowed: true, media: sniffed };
}
