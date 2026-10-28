import { xPostId, type XPostId } from "../identity/ids";

/** X post ids are snowflakes: 64-bit unsigned, so at most 20 digits. */
const POST_ID = /^\d{1,20}$/;

/** A post's URL on X: `https://x.com/<handle>/status/<id>`, twitter.com and mobile hosts too. */
const POST_URL =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:\w{1,15}|i\/web)\/status(?:es)?\/(\d{1,20})(?:[/?#].*)?$/i;

/**
 * The X post a reply answers, from what a bot passed as `in_reply_to`: a bare post id or the
 * post's URL. Null when it is neither, which the create refuses as `reply_target_invalid`.
 */
export function replyTargetId(raw: string): XPostId | null {
  const value = raw.trim();
  if (POST_ID.test(value)) {
    return xPostId(value);
  }
  const match = POST_URL.exec(value);
  return match?.[1] === undefined ? null : xPostId(match[1]);
}
