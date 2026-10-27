import { checkFetchedMedia } from "../../entities/media/fetched_media";
import { checkMediaUrl } from "../../entities/media/media_url";
import type { Millis } from "../../entities/time/instant";
import type { FetchRefusal, FetchResult, MediaFetcher } from "../../use_cases/ports/media_fetcher";

/** Redirects followed before giving up; each hop is re-checked against the allowlist. */
export const MAX_REDIRECTS = 3;
/** The whole fetch, every hop and the body included, inside `stage_media_from_url`'s 20 s. */
export const MEDIA_FETCH_TIMEOUT: Millis = 15_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Cloudflare's answer to a subrequest for a private or reserved address (U18). */
const CLOUDFLARE_REFUSED = "error code: 1003";
const REFUSAL_BODY_BYTES = 1024;

type Hop =
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "body"; readonly response: Response }
  | { readonly kind: "refused"; readonly reason: FetchRefusal };

const refused = (reason: FetchRefusal): FetchResult => ({ ok: false, reason });

/** The body's bytes, or null once it passes `maxBytes` (the read stops there). */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const read = await reader?.read();
    if (read === undefined || read.done) {
      break;
    }
    total += read.value.length;
    if (total > maxBytes) {
      await reader?.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** A 403 whose body is Cloudflare's 1003: the destination was refused, not merely unreachable. */
async function isCloudflareRefusal(response: Response): Promise<boolean> {
  const head = await readCapped(response, REFUSAL_BODY_BYTES);
  return head !== null && new TextDecoder().decode(head).includes(CLOUDFLARE_REFUSED);
}

/**
 * The production `MediaFetcher` (plan §3.5, U18): https only, the host allowlist from
 * `GROKCHAT_MEDIA_HOSTS`, literal-IP hosts refused, `redirect: "manual"` with every hop re-checked
 * by the same `checkMediaUrl`, the body read only up to the cap, and the kind decided by the
 * magic bytes. Workers cannot resolve DNS, so the allowlist is the guard; a Cloudflare 403
 * "error code: 1003" (a private address behind an allowed name) is a refusal.
 */
export class HttpsMediaFetcher implements MediaFetcher {
  constructor(
    private readonly allowedHosts: readonly string[],
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly timeout: Millis = MEDIA_FETCH_TIMEOUT,
  ) {}

  async fetch(
    url: string,
    maxBytes: number,
    allowedTypes: readonly string[],
  ): Promise<FetchResult> {
    const signal = AbortSignal.timeout(this.timeout);
    try {
      let current = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const step = await this.hop(current, signal);
        if (step.kind === "refused") {
          return refused(step.reason);
        }
        if (step.kind === "body") {
          return await this.accept(step.response, maxBytes, allowedTypes);
        }
        current = step.to;
      }
      return refused("unreachable");
    } catch {
      return refused("unreachable");
    }
  }

  private async hop(url: string, signal: AbortSignal): Promise<Hop> {
    const decision = checkMediaUrl(url, this.allowedHosts);
    if (!decision.allowed) {
      return { kind: "refused", reason: decision.reason };
    }
    const response = await this.fetcher(url, { redirect: "manual", signal });
    if (REDIRECTS.has(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      return location === null
        ? { kind: "refused", reason: "unreachable" }
        : { kind: "redirect", to: new URL(location, url).href };
    }
    if (response.status === 403) {
      const reason = (await isCloudflareRefusal(response)) ? "host_not_allowed" : "unreachable";
      return { kind: "refused", reason };
    }
    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel();
      return { kind: "refused", reason: "unreachable" };
    }
    return { kind: "body", response };
  }

  private async accept(
    response: Response,
    maxBytes: number,
    allowedTypes: readonly string[],
  ): Promise<FetchResult> {
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      await response.body?.cancel();
      return refused("too_large");
    }
    const bytes = await readCapped(response, maxBytes);
    if (bytes === null) {
      return refused("too_large");
    }
    const checked = checkFetchedMedia(bytes, maxBytes, allowedTypes);
    return checked.allowed
      ? { ok: true, bytes, contentType: checked.media.contentType }
      : refused(checked.reason);
  }
}
