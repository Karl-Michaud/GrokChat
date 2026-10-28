import type { AccountId, XPostId } from "../identity/ids";
import { DAY, HOUR, SECOND, type Instant, type Millis } from "../time/instant";

/**
 * A post on one of our accounts that GrokChat did not publish: written in the X app or anywhere
 * else, found on the account's own timeline (GROKCHAT-19). Read-only: GrokChat only reads its
 * metrics, on the same schedule as its own posts.
 */
export interface ImportedPost {
  readonly xPostId: XPostId;
  readonly accountId: AccountId;
  /** X's v2 `text` as returned: URLs as t.co links. */
  readonly text: string;
  readonly createdAt: Instant;
  /** The post it replies to; null for an original post. */
  readonly inReplyTo: XPostId | null;
  readonly importedAt: Instant;
}

/** How often an account's timeline is read for new posts. */
export const IMPORT_INTERVAL: Millis = 6 * HOUR;

/** How far back the first import reads: X gives private metrics only for posts under 30 days. */
export const IMPORT_BACKFILL: Millis = 30 * DAY;

/** Due when the account was never imported, or its last import is `IMPORT_INTERVAL` old. */
export function importDue(lastRunAt: Instant | null, now: Instant): boolean {
  return lastRunAt === null || now - lastRunAt >= IMPORT_INTERVAL;
}

/**
 * Where an import starts reading: the second after the newest post already seen (X's timestamps
 * are to the second, so that post is not read and billed again), never more than
 * `IMPORT_BACKFILL` back.
 */
export function importSince(newestSeen: Instant | null, now: Instant): Instant {
  const floor = now - IMPORT_BACKFILL;
  return newestSeen === null ? floor : Math.max(floor, newestSeen + SECOND);
}
