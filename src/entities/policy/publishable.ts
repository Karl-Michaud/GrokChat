import { disclosureComplete, type Account, type AccountStatus } from "../accounts/account";
import { inQuietHours } from "../accounts/posting_policy";
import { ALLOWED, refuse, type Decision } from "../decision";
import type { Post } from "../posts/post";
import { hasSchemeUrl } from "../text/post_text";
import { MINUTE, type Instant } from "../time/instant";
import { localDayKey, minuteOfDay, nextWallMinute } from "../time/zoned_time";
import type { RecentActivity } from "./recent_activity";

export type TimingRefusal = "quiet_hours" | "cap" | "gap";

export type PublishRefusal =
  "paused" | "disconnected" | "needs_reconnect" | "undisclosed" | "link_policy" | TimingRefusal;

const STATUS_REFUSAL: Readonly<Record<AccountStatus, PublishRefusal | null>> = {
  ACTIVE: null,
  PAUSED: "paused",
  DISCONNECTED: "disconnected",
  NEEDS_RECONNECT: "needs_reconnect",
};

/** A refusal that time lifts, with the instant it lifts at (computed only when asked). */
interface TimingBlock {
  readonly reason: TimingRefusal;
  readonly liftAt: () => Instant;
}

function standingRefusal(account: Account, post: Post): PublishRefusal | null {
  const status = STATUS_REFUSAL[account.status];
  if (status !== null) {
    return status;
  }
  if (!disclosureComplete(account.disclosure)) {
    return "undisclosed";
  }
  const links = post.parts.some((part) => hasSchemeUrl(part.text));
  return account.policy.linkPolicy === "REFUSE" && links ? "link_policy" : null;
}

function timingBlock(
  account: Account,
  post: Post,
  now: Instant,
  recent: RecentActivity,
): TimingBlock | null {
  const { policy } = account;
  const quiet = policy.quietHours;
  if (quiet !== null && inQuietHours(quiet, minuteOfDay(now, policy.tz))) {
    return { reason: "quiet_hours", liftAt: () => nextWallMinute(now, policy.tz, quiet.endMinute) };
  }
  const others = recent.posts.filter((activity) => activity.postId !== post.id);
  const today = localDayKey(now, policy.tz);
  const count = others.filter((activity) => localDayKey(activity.firstAt, policy.tz) === today);
  if (count.length >= policy.dailyCap) {
    return { reason: "cap", liftAt: () => nextWallMinute(now, policy.tz, 0) };
  }
  const last = Math.max(...others.map((activity) => activity.lastAt));
  if (now - last < policy.minGap) {
    return { reason: "gap", liftAt: () => last + policy.minGap };
  }
  return null;
}

/**
 * The gate every part passes under the account's publish lock (plan §3.1, ReservePart): ACTIVE,
 * disclosure, link policy, quiet hours, then the cap and the gap over every other post with a part
 * SENDING, SENT or UNKNOWN (the cap counts the account's local day).
 */
export function checkPublishable(
  account: Account,
  post: Post,
  now: Instant,
  recent: RecentActivity,
): Decision<PublishRefusal> {
  const standing = standingRefusal(account, post);
  if (standing !== null) {
    return refuse(standing);
  }
  const block = timingBlock(account, post, now, recent);
  return block === null ? ALLOWED : refuse(block.reason);
}

/** How long a refusal that no clock lifts (status, disclosure, links) waits before a retry. */
export const STANDING_RETRY = MINUTE;

const MAX_STEPS = 8;

/** The earliest instant from `now` at which the gate allows the post (RESUMING's resumeAt). */
export function nextAllowedAt(
  account: Account,
  post: Post,
  now: Instant,
  recent: RecentActivity,
): Instant {
  if (standingRefusal(account, post) !== null) {
    return now + STANDING_RETRY;
  }
  let at = now;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const block = timingBlock(account, post, at, recent);
    if (block === null) {
      return at;
    }
    at = block.liftAt();
  }
  return at;
}
