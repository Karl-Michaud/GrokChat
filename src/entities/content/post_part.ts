import { ALLOWED, refuse, type Decision } from "../decision";
import { isValidPostText, MAX_WEIGHTED_LENGTH, weightedLength } from "../text/post_text";
import type { MediaKind } from "./staged_media";

export type PartRefusal =
  "empty" | "too_long" | "invalid_characters" | "too_many_photos" | "gif_not_alone";

export const MAX_PHOTOS = 4;
export const MAX_THREAD_PARTS = 25;

/** 280 weighted characters and X's character rules (U13), and ≤ 4 photos or exactly 1 GIF (plan §3.1). */
export function validatePart(text: string, media: readonly MediaKind[]): Decision<PartRefusal> {
  if (text.trim().length === 0 && media.length === 0) {
    return refuse("empty");
  }
  if (weightedLength(text) > MAX_WEIGHTED_LENGTH) {
    return refuse("too_long");
  }
  if (text.length > 0 && !isValidPostText(text)) {
    return refuse("invalid_characters");
  }
  const gifs = media.filter((kind) => kind === "GIF").length;
  if (gifs > 0 && media.length > 1) {
    return refuse("gif_not_alone");
  }
  if (media.length > MAX_PHOTOS) {
    return refuse("too_many_photos");
  }
  return ALLOWED;
}
