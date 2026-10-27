/** The `MediaFetcher` contract (plan §3.2, §3.5): what the stub and the https driver both honour. */
import { expect, it } from "vitest";
import { MAX_MEDIA_BYTES } from "../../src/entities/content/staged_media";
import type { MediaFetcher } from "../../src/use_cases/ports/media_fetcher";
import { MEDIA_TYPES } from "../../src/use_cases/stage_media_from_url/interactor";

export interface MediaFetcherSubject {
  readonly fetcher: MediaFetcher;
  /** Makes `url` answer with `bytes`. */
  serve(url: string, bytes: Uint8Array): void;
}

export const MEDIA_HOST = "media.example";
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

export function mediaFile(magic: readonly number[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(magic);
  return bytes;
}

export const aPng = (size = 32): Uint8Array => mediaFile(PNG, size);
export const aGif = (size = 32): Uint8Array => mediaFile(GIF, size);

const url = (name: string): string => `https://${MEDIA_HOST}/${name}`;

export function mediaFetcherContract(make: () => MediaFetcherSubject): void {
  it("returns served media with the type its magic bytes say", async () => {
    const subject = make();
    const png = aPng();
    subject.serve(url("a.png"), png);
    expect(await subject.fetcher.fetch(url("a.png"), 1024, MEDIA_TYPES)).toStrictEqual({
      ok: true,
      bytes: png,
      contentType: "image/png",
    });
  });

  it("answers unreachable for a URL nothing serves", async () => {
    expect(await make().fetcher.fetch(url("missing.png"), 1024, MEDIA_TYPES)).toStrictEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("refuses more bytes than the cap, and bytes that are not an allowed media type", async () => {
    const subject = make();
    subject.serve(url("big.png"), aPng(2048));
    subject.serve(url("text.png"), new TextEncoder().encode("<html>not an image</html>"));
    subject.serve(url("a.gif"), aGif());
    const fetch = (name: string, types: readonly string[] = MEDIA_TYPES) =>
      subject.fetcher.fetch(url(name), 1024, types);
    expect(await fetch("big.png")).toStrictEqual({ ok: false, reason: "too_large" });
    expect(await fetch("text.png")).toStrictEqual({ ok: false, reason: "bad_type" });
    expect(await fetch("a.gif", ["image/png"])).toStrictEqual({ ok: false, reason: "bad_type" });
  });

  it("caps a photo at 5 MB and a GIF at 15 MB, under the GIF-sized request cap", async () => {
    const subject = make();
    const size = MAX_MEDIA_BYTES.PHOTO + 1;
    subject.serve(url("photo.png"), aPng(size));
    subject.serve(url("anim.gif"), aGif(size));
    const cap = MAX_MEDIA_BYTES.GIF;
    expect(await subject.fetcher.fetch(url("photo.png"), cap, MEDIA_TYPES)).toStrictEqual({
      ok: false,
      reason: "too_large",
    });
    expect(await subject.fetcher.fetch(url("anim.gif"), cap, MEDIA_TYPES)).toMatchObject({
      ok: true,
      contentType: "image/gif",
    });
  });
}
