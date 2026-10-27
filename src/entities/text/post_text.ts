import twitterText from "twitter-text";

/**
 * X's counting and URL rules, behind pure functions (plan §3.1, U13). twitter-text 3.1.0 passes
 * the upstream conformance suite (tests/unit/entities/text).
 */

/** X's limit for every GrokChat account (no Premium long posts in v0). */
export const MAX_WEIGHTED_LENGTH = 280;

/** Weighted length as X counts it: NFC, emoji and CJK count 2, every URL 23. */
export function weightedLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}

/**
 * X's own validity: not empty, within 280 weighted characters, and free of the characters X
 * refuses (such as U+FFFE).
 */
export function isValidPostText(text: string): boolean {
  return twitterText.parseTweet(text).valid;
}

/** Every URL X would link, including bare domains such as `example.com`. */
export function extractUrls(text: string): readonly string[] {
  return twitterText.extractUrls(text);
}

export function containsUrl(text: string): boolean {
  return extractUrls(text).length > 0;
}

const SCHEME = /^https?:\/\//i;

/** True when a URL carries a scheme: X bills only those as "create with URL" (U4). */
export function hasSchemeUrl(text: string): boolean {
  return extractUrls(text).some((url) => SCHEME.test(url));
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">" } as const;

/**
 * The form two texts are compared in when reconciling an unknown outcome (plan §3.3 #6): X
 * HTML-escapes `&`, `<` and `>`; both sides are NFC-normalised and trimmed.
 */
export function normalisePostText(text: string): string {
  return text
    .replace(/&(amp|lt|gt);/g, (entity) => ENTITIES[entity as keyof typeof ENTITIES])
    .normalize("NFC")
    .trim();
}
