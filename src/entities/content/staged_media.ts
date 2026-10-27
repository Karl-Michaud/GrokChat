import type { AccountId, PostId, StagedMediaId } from "../identity/ids";
import type { Instant } from "../time/instant";

export type MediaKind = "PHOTO" | "GIF";

/** Media fetched or uploaded into GrokChat's store, waiting to be attached to a post. */
export interface StagedMedia {
  readonly id: StagedMediaId;
  readonly ownerAccountId: AccountId;
  readonly kind: MediaKind;
  readonly contentType: string;
  readonly size: number;
  readonly storageKey: string;
  readonly sha256: string;
  readonly stagedAt: Instant;
  /** The post it was attached to, if any (decides when it is cleaned up). */
  readonly attachedTo: PostId | null;
}

const MB = 1024 * 1024;

/** X's limits: images ≤ 5 MB, GIFs ≤ 15 MB (plan §1.1). */
export const MAX_MEDIA_BYTES: Readonly<Record<MediaKind, number>> = { PHOTO: 5 * MB, GIF: 15 * MB };

/** A direct dashboard upload is capped lower: one request body (plan §3.3 #3). */
export const MAX_UPLOAD_BYTES = 4 * MB;

export interface SniffedMedia {
  readonly kind: MediaKind;
  readonly contentType: string;
}

const SIGNATURES: readonly (SniffedMedia & { readonly magic: readonly number[] })[] = [
  {
    kind: "PHOTO",
    contentType: "image/png",
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { kind: "PHOTO", contentType: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { kind: "GIF", contentType: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] },
];

function isWebp(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number): string => String.fromCharCode(...bytes.slice(from, to));
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

/** The media kind from the file's magic bytes, never from a claimed content type. */
export function sniffMedia(bytes: Uint8Array): SniffedMedia | null {
  const match = SIGNATURES.find((signature) =>
    signature.magic.every((byte, index) => bytes[index] === byte),
  );
  if (match !== undefined) {
    return { kind: match.kind, contentType: match.contentType };
  }
  return isWebp(bytes) ? { kind: "PHOTO", contentType: "image/webp" } : null;
}
