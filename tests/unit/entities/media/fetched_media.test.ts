import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_MEDIA_BYTES } from "../../../../src/entities/content/staged_media";
import { checkFetchedMedia } from "../../../../src/entities/media/fetched_media";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38];
const ALL = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** `size` bytes that start with `magic`. */
function file(magic: readonly number[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(magic);
  return bytes;
}

describe("checkFetchedMedia (plan §3.5)", () => {
  it("accepts media within every limit, with the kind and type from the magic bytes", () => {
    expect(checkFetchedMedia(file(PNG, 20), 20, ALL)).toStrictEqual({
      allowed: true,
      media: { kind: "PHOTO", contentType: "image/png" },
    });
    expect(checkFetchedMedia(file(GIF, 9), 100, ["image/gif"])).toStrictEqual({
      allowed: true,
      media: { kind: "GIF", contentType: "image/gif" },
    });
  });

  it("refuses more bytes than the caller's cap, even when they are not media", () => {
    expect(checkFetchedMedia(file(PNG, 21), 20, ALL)).toStrictEqual({
      allowed: false,
      reason: "too_large",
    });
    expect(checkFetchedMedia(new Uint8Array(21), 20, ALL)).toMatchObject({ reason: "too_large" });
  });

  it("refuses bytes that are not media, or a type the caller does not allow", () => {
    expect(checkFetchedMedia(new Uint8Array(10), 20, ALL)).toStrictEqual({
      allowed: false,
      reason: "bad_type",
    });
    expect(checkFetchedMedia(file(PNG, 10), 20, ["image/gif"])).toMatchObject({
      reason: "bad_type",
    });
  });

  it("applies X's limit per kind: a photo stops at 5 MB, a GIF at 15 MB", () => {
    const cap = MAX_MEDIA_BYTES.GIF;
    expect(checkFetchedMedia(file(PNG, MAX_MEDIA_BYTES.PHOTO), cap, ALL).allowed).toBe(true);
    expect(checkFetchedMedia(file(PNG, MAX_MEDIA_BYTES.PHOTO + 1), cap, ALL)).toMatchObject({
      reason: "too_large",
    });
    expect(checkFetchedMedia(file(GIF, MAX_MEDIA_BYTES.PHOTO + 1), cap, ALL).allowed).toBe(true);
    expect(checkFetchedMedia(file(GIF, cap), cap, ALL).allowed).toBe(true);
  });

  it("property: anything over the cap is too large; a PNG at or under it is accepted", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 400 }),
        fc.integer({ min: 8, max: 400 }),
        (size, cap) => {
          const result = checkFetchedMedia(file(PNG, size), cap, ALL);
          expect(result.allowed).toBe(size <= cap);
          if (!result.allowed) {
            expect(result.reason).toBe("too_large");
          }
        },
      ),
    );
  });

  it("property: bytes without a known signature are never accepted", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 64 }), (bytes) => {
        fc.pre(bytes[0] !== 0x89 && bytes[0] !== 0xff && bytes[0] !== 0x47 && bytes[0] !== 0x52);
        expect(checkFetchedMedia(bytes, 64, ALL)).toStrictEqual({
          allowed: false,
          reason: "bad_type",
        });
      }),
    );
  });
});
