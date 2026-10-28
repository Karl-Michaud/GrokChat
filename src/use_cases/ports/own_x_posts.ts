import type { AccountId, XPostId } from "../../entities/identity/ids";

/**
 * Whether an X post is one the account published through GrokChat: a SENT part of one of the
 * account's own posts carries that X id. X allows API replies only to the account's own posts or
 * to authors who engaged with it, so a reply target must pass this (GROKCHAT-17, 2026-10-28).
 */
export interface OwnXPosts {
  isOwnPublishedXPost(account: AccountId, xPostId: XPostId): Promise<boolean>;
}
