import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { followerGrowth, followersAt } from "../../../../src/entities/analytics/followers";
import { DAY } from "../../../../src/entities/time/instant";
import { aFollowerSnapshot, OTHER_ACCOUNT, T0 } from "../../support/builders";

describe("follower growth (GROKCHAT-15)", () => {
  const history = [
    aFollowerSnapshot(T0 - 2 * DAY, 100),
    aFollowerSnapshot(T0 - DAY, 110),
    aFollowerSnapshot(T0, 125),
    aFollowerSnapshot(T0 + DAY, 120),
    aFollowerSnapshot(T0, 40, OTHER_ACCOUNT),
    aFollowerSnapshot(T0 + DAY, 50, OTHER_ACCOUNT),
  ];

  it("sums the accounts' newest counts before an instant; null before any", () => {
    expect(followersAt(history, T0 - 3 * DAY)).toBeNull();
    expect(followersAt(history, T0)).toBe(110);
    expect(followersAt(history, T0 + 1)).toBe(165);
    expect(followersAt(history, T0 + 2 * DAY)).toBe(170);
  });

  it("each account's newest in the window minus its newest before, or its first in the window", () => {
    // Account 1: 120 - 110 = 10; account 2 has nothing before: 50 - 40 = 10.
    expect(followerGrowth(history, { from: T0 - DAY + 1, to: T0 + 2 * DAY })).toBe(20);
    // Only account 1 read before and inside: 125 - 110.
    expect(followerGrowth(history, { from: T0 - DAY + 1, to: T0 + 1 })).toBe(15 + 0);
    // Nothing read inside: no growth, even with reads before.
    expect(followerGrowth(history, { from: T0 + 2 * DAY, to: T0 + 3 * DAY })).toBe(0);
    expect(followerGrowth([], { from: 0, to: T0 })).toBe(0);
  });

  it("property: with a read before both, growth over two windows adds up", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 60 }), fc.nat({ max: 5_000 })), {
          maxLength: 20,
        }),
        fc.integer({ min: 1, max: 60 }),
        (reads, split) => {
          const unique = [...new Map(reads)]
            .sort(([a], [b]) => a - b)
            .map(([day, count]) => aFollowerSnapshot(T0 + day * DAY, count));
          const all = [aFollowerSnapshot(T0, 0), ...unique];
          const a = { from: T0 + 1, to: T0 + split * DAY };
          const b = { from: T0 + split * DAY, to: T0 + 61 * DAY };
          const whole = { from: T0 + 1, to: T0 + 61 * DAY };
          expect(followerGrowth(all, a) + followerGrowth(all, b)).toBe(followerGrowth(all, whole));
        },
      ),
    );
  });
});
