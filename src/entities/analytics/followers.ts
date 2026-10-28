import type { AccountId } from "../identity/ids";
import type { FollowerSnapshot } from "../metrics/follower_snapshot";
import { inWindow, type Instant, type TimeWindow } from "../time/instant";

/**
 * The follower arithmetic (GROKCHAT-15). Every function takes the snapshots oldest first, as
 * `FollowerHistory` returns them, so the later of two reads of an account is its newer one.
 */

/** Each account's newest count taken before `at`. */
function latestBefore(
  snapshots: readonly FollowerSnapshot[],
  at: Instant,
): ReadonlyMap<AccountId, number> {
  return new Map(
    snapshots
      .filter((snapshot) => snapshot.takenAt < at)
      .map((snapshot) => [snapshot.accountId, snapshot.followers]),
  );
}

/** Followers summed over the accounts read before `at`; null when none is. */
export function followersAt(snapshots: readonly FollowerSnapshot[], at: Instant): number | null {
  const latest = [...latestBefore(snapshots, at).values()];
  return latest.length === 0 ? null : latest.reduce((total, count) => total + count, 0);
}

/**
 * The followers gained in the window, summed over the accounts read in it: each one's newest
 * count in the window minus its newest before it, or minus its first in the window when it has
 * none before (an account connected in the window starts from its first read, not from zero).
 */
export function followerGrowth(snapshots: readonly FollowerSnapshot[], window: TimeWindow): number {
  const before = latestBefore(snapshots, window.from);
  const inside = snapshots.filter((snapshot) => inWindow(window, snapshot.takenAt));
  const first = new Map<AccountId, number>();
  const last = new Map<AccountId, number>();
  for (const snapshot of inside) {
    if (!first.has(snapshot.accountId)) {
      first.set(snapshot.accountId, snapshot.followers);
    }
    last.set(snapshot.accountId, snapshot.followers);
  }
  return [...last].reduce(
    (growth, [account, count]) =>
      growth + count - (before.get(account) ?? first.get(account) ?? count),
    0,
  );
}
