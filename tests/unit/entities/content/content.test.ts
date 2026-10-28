import { describe, expect, it } from "vitest";
import {
  MAX_PHOTOS,
  MAX_THREAD_PARTS,
  validatePart,
} from "../../../../src/entities/content/post_part";
import {
  MAX_MEDIA_BYTES,
  MAX_UPLOAD_BYTES,
  sniffMedia,
} from "../../../../src/entities/content/staged_media";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

describe("validatePart", () => {
  it("allows text, up to four photos, or one GIF", () => {
    expect(validatePart("hi", [])).toStrictEqual({ allowed: true });
    expect(validatePart("", ["PHOTO"]).allowed).toBe(true);
    expect(validatePart("hi", ["PHOTO", "PHOTO", "PHOTO", "PHOTO"]).allowed).toBe(true);
    expect(validatePart("hi", ["GIF"]).allowed).toBe(true);
    expect(MAX_PHOTOS).toBe(4);
    expect(MAX_THREAD_PARTS).toBe(25);
  });

  it.each([
    ["empty", "   ", []],
    ["too_long", "a".repeat(281), []],
    ["too_many_photos", "hi", ["PHOTO", "PHOTO", "PHOTO", "PHOTO", "PHOTO"]],
    ["invalid_characters", "bad \uFFFE char", []],
    ["gif_not_alone", "hi", ["GIF", "PHOTO"]],
    ["gif_not_alone", "hi", ["PHOTO", "GIF"]],
    ["gif_not_alone", "hi", ["GIF", "GIF"]],
  ] as const)("refuses %s", (reason, text, media) => {
    expect(validatePart(text, media)).toStrictEqual({ allowed: false, reason });
  });

  it("280 weighted characters is the limit (emoji count 2)", () => {
    expect(validatePart("a".repeat(280), []).allowed).toBe(true);
    expect(validatePart("👾".repeat(140), []).allowed).toBe(true);
    expect(validatePart("👾".repeat(141), []).allowed).toBe(false);
  });
});

describe("sniffMedia (magic bytes)", () => {
  it.each([
    [
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0],
      { kind: "PHOTO", contentType: "image/png" },
    ],
    [[0xff, 0xd8, 0xff, 0xe0], { kind: "PHOTO", contentType: "image/jpeg" }],
    [[...ascii("GIF89a")], { kind: "GIF", contentType: "image/gif" }],
    [
      [...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP")],
      { kind: "PHOTO", contentType: "image/webp" },
    ],
  ])("%j → %j", (magic, expected) => {
    expect(sniffMedia(bytes(...magic))).toStrictEqual(expected);
  });

  it.each([
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]],
    [[0xff, 0xd8]],
    [[...ascii("GIF7")]],
    [[...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")]],
    [[...ascii("RIFX"), 1, 2, 3, 4, ...ascii("WEBP")]],
    [[...ascii("<svg")]],
    [[]],
  ])("refuses %j", (magic) => {
    expect(sniffMedia(bytes(...magic))).toBeNull();
  });

  it("size limits", () => {
    expect(MAX_MEDIA_BYTES).toStrictEqual({ PHOTO: 5 * 1024 * 1024, GIF: 15 * 1024 * 1024 });
    expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024);
  });
});
