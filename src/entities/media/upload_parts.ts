/**
 * A bot's own file, sent through `upload_media` in base64 parts (GROKCHAT-20): Grok's sandbox has
 * no outbound network, so the bytes can only leave through the tool call itself. Each part carries
 * its own SHA-256, so a garbled part is refused at once and only that part is resent; the whole
 * file's SHA-256 is checked once every part is in.
 */
import { MAX_UPLOAD_BYTES } from "../content/staged_media";
import { ALLOWED, refuse, type Decision } from "../decision";
import { HOUR, type Instant, type Millis } from "../time/instant";

/** One part's decoded bytes at most: its base64 (about 350,000 characters) fits one tool call. */
export const MAX_PART_BYTES = 256 * 1024;

/** Enough parts of the largest size for the largest file (a 15 MB GIF): 60. */
export const MAX_UPLOAD_PARTS = Math.ceil(MAX_UPLOAD_BYTES / MAX_PART_BYTES);

/** An unfinished upload is refused (`upload_expired`) and its parts deleted an hour after it opened. */
export const UPLOAD_TTL: Millis = HOUR;

export function uploadExpiresAt(openedAt: Instant): Instant {
  return openedAt + UPLOAD_TTL;
}

export function uploadExpired(expiresAt: Instant, now: Instant): boolean {
  return now >= expiresAt;
}

/** Part `index` (from 0) of `count` parts, with `count` between 1 and `MAX_UPLOAD_PARTS`. */
export function checkPart(index: number, count: number): Decision<"part_out_of_range"> {
  const countOk = Number.isInteger(count) && count >= 1 && count <= MAX_UPLOAD_PARTS;
  const indexOk = Number.isInteger(index) && index >= 0 && index < count;
  return countOk && indexOk ? ALLOWED : refuse("part_out_of_range");
}

/** The part indexes not received yet, in order. */
export function missingParts(count: number, received: Iterable<number>): readonly number[] {
  const have = new Set(received);
  return Array.from({ length: count }, (_, index) => index).filter((index) => !have.has(index));
}

/** The parts' bytes, in the order given, as one file. */
export function joinParts(parts: readonly Uint8Array[]): Uint8Array {
  const file = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    file.set(part, offset);
    offset += part.length;
  }
  return file;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SEXTETS = new Map(Array.from({ length: 64 }, (_, index) => [ALPHABET.charAt(index), index]));
/** Line breaks (a wrapped `base64` output) are the only thing tolerated besides the alphabet. */
const LINE_BREAKS = /[\r\n]/g;

/**
 * Standard base64 (RFC 4648 §4, with `=` padding), strictly: any other character, a length that
 * is not a multiple of 4, padding anywhere but the end, or non-zero bits after the last byte is
 * refused (null), so one string never decodes to two files. Line breaks are ignored.
 */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(LINE_BREAKS, "");
  if (clean.length % 4 !== 0) {
    return null;
  }
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (const char of clean.slice(0, clean.length - padding)) {
    const sextet = SEXTETS.get(char);
    if (sextet === undefined) {
      return null;
    }
    buffer = (buffer << 6) | sextet;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = buffer >> bits;
      at += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  return buffer === 0 ? out : null;
}
