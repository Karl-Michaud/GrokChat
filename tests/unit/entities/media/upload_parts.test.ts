import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "../../../../src/entities/content/staged_media";
import { HOUR } from "../../../../src/entities/time/instant";
import {
  checkPart,
  decodeBase64,
  joinParts,
  MAX_PART_BYTES,
  MAX_UPLOAD_PARTS,
  missingParts,
  UPLOAD_TTL,
  uploadExpired,
  uploadExpiresAt,
} from "../../../../src/entities/media/upload_parts";

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Cuts `bytes` at the given (sorted, de-duplicated) offsets. */
function split(bytes: Uint8Array, cuts: readonly number[]): Uint8Array[] {
  const edges = [0, ...new Set(cuts.map((cut) => cut % (bytes.length + 1)))]
    .sort((a, b) => a - b)
    .concat(bytes.length);
  return edges.slice(1).map((end, index) => bytes.slice(edges[index], end));
}

describe("upload parts: limits and expiry (GROKCHAT-20)", () => {
  it("a part holds 256 KiB; 60 parts hold the largest upload; an upload lives an hour", () => {
    expect(MAX_PART_BYTES).toBe(262_144);
    expect(MAX_UPLOAD_PARTS).toBe(60);
    expect(MAX_UPLOAD_PARTS * MAX_PART_BYTES).toBeGreaterThanOrEqual(MAX_UPLOAD_BYTES);
    expect((MAX_UPLOAD_PARTS - 1) * MAX_PART_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(UPLOAD_TTL).toBe(HOUR);
    expect(uploadExpiresAt(1_000)).toBe(1_000 + HOUR);
    expect(uploadExpired(1_000, 999)).toBe(false);
    expect(uploadExpired(1_000, 1_000)).toBe(true);
    expect(uploadExpired(1_000, 1_001)).toBe(true);
  });

  it("checkPart: index from 0 below count, count from 1 to 60, integers only", () => {
    const ok = { allowed: true };
    const out = { allowed: false, reason: "part_out_of_range" };
    expect(checkPart(0, 1)).toStrictEqual(ok);
    expect(checkPart(59, 60)).toStrictEqual(ok);
    expect(checkPart(1, 1)).toStrictEqual(out);
    expect(checkPart(-1, 2)).toStrictEqual(out);
    expect(checkPart(0, 0)).toStrictEqual(out);
    expect(checkPart(0, 61)).toStrictEqual(out);
    expect(checkPart(0.5, 2)).toStrictEqual(out);
    expect(checkPart(0, 1.5)).toStrictEqual(out);
  });

  it("missingParts lists the indexes not received, in order", () => {
    expect(missingParts(4, [2, 0])).toStrictEqual([1, 3]);
    expect(missingParts(3, [0, 1, 2, 2])).toStrictEqual([]);
    expect(missingParts(2, [])).toStrictEqual([0, 1]);
    expect(missingParts(2, [5])).toStrictEqual([0, 1]);
  });

  it("property: any split of any bytes joins back to the same file and hash", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 2_000 }),
        fc.array(fc.nat(), { maxLength: 8 }),
        (bytes, cuts) => {
          const joined = joinParts(split(bytes, cuts));
          expect(joined).toStrictEqual(bytes);
          expect(sha(joined)).toBe(sha(bytes));
        },
      ),
    );
  });

  it("property: one flipped byte in any part changes that part's hash and the file's", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 1_000 }),
        fc.array(fc.nat(), { maxLength: 5 }),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        (bytes, cuts, at, flip) => {
          const parts = split(bytes, cuts).filter((part) => part.length > 0);
          const which = at % parts.length;
          const part = parts[which] ?? new Uint8Array();
          const garbled = part.slice();
          const offset = at % garbled.length;
          garbled[offset] = (garbled[offset] ?? 0) ^ flip;
          expect(sha(garbled)).not.toBe(sha(part));
          const file = joinParts(parts.map((item, index) => (index === which ? garbled : item)));
          expect(sha(file)).not.toBe(sha(bytes));
        },
      ),
    );
  });
});

describe("decodeBase64: strict standard base64 (GROKCHAT-20)", () => {
  it("decodes padded base64 of every length", () => {
    expect(decodeBase64("")).toStrictEqual(new Uint8Array());
    expect(decodeBase64("/w==")).toStrictEqual(new Uint8Array([255]));
    expect(decodeBase64("//8=")).toStrictEqual(new Uint8Array([255, 255]));
    expect(decodeBase64("////")).toStrictEqual(new Uint8Array([255, 255, 255]));
    expect(decodeBase64("AAEC")).toStrictEqual(new Uint8Array([0, 1, 2]));
    expect(decodeBase64("+/+/")).toStrictEqual(new Uint8Array([0xfb, 0xff, 0xbf]));
    expect(decodeBase64("aGVsbG8=")).toStrictEqual(new TextEncoder().encode("hello"));
  });

  it("ignores line breaks, as a wrapped encoder writes them", () => {
    expect(decodeBase64("aGVs\nbG8=\r\n")).toStrictEqual(new TextEncoder().encode("hello"));
    expect(decodeBase64("aG\rVsbG8=")).toStrictEqual(new TextEncoder().encode("hello"));
  });

  it.each([
    ["a length not a multiple of 4", "aGVsbG8"],
    ["a space", "aGVs bG8="],
    ["a tab", "aGVs\tbG8="],
    ["base64url's -", "-_8="],
    ["base64url's _", "__8="],
    ["padding inside", "aG=sbG8="],
    ["three padding characters", "a==="],
    ["only padding", "===="],
    ["a non-zero bit after the last byte (two padding)", "/x=="],
    ["a non-zero bit after the last byte (one padding)", "//9="],
    ["a non-ASCII letter", "aGVsbGé="],
  ])("refuses %s", (_, text) => {
    expect(decodeBase64(text)).toBeNull();
  });

  it("property: decodes what a standard encoder writes, with or without line breaks", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), fc.nat({ max: 80 }), (bytes, width) => {
        const text = b64(bytes);
        expect(decodeBase64(text)).toStrictEqual(bytes);
        const wrapped =
          width === 0
            ? text
            : (text.match(new RegExp(`.{1,${String(width + 1)}}`, "g")) ?? []).join("\n");
        expect(decodeBase64(wrapped)).toStrictEqual(bytes);
      }),
    );
  });

  it("property: any string it accepts is canonical, so it is the encoding of what it decodes to", () => {
    const chars = fc.constantFrom(
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=-_ ".split(""),
    );
    fc.assert(
      fc.property(fc.array(chars, { maxLength: 24 }), (letters) => {
        const text = letters.join("");
        const decoded = decodeBase64(text);
        if (decoded !== null) {
          expect(b64(decoded)).toBe(text);
        }
      }),
    );
  });
});
