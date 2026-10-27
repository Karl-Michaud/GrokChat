import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AccountStatus } from "../../../../src/entities/accounts/account";
import { postId } from "../../../../src/entities/identity/ids";
import {
  checkPublishable,
  nextAllowedAt,
  STANDING_RETRY,
} from "../../../../src/entities/policy/publishable";
import { activityOf, type RecentActivity } from "../../../../src/entities/policy/recent_activity";
import { DAY, HOUR, MINUTE } from "../../../../src/entities/time/instant";
import { localDayKey, minuteOfDay } from "../../../../src/entities/time/zoned_time";
import {
  aPolicy,
  aPost,
  anAccount,
  part,
  sendingState,
  sentState,
  T0,
  unknownState,
} from "../../support/builders";
import { instants, ZONES } from "../../support/arbitraries";

const NONE: RecentActivity = { posts: [] };
const post = aPost();

function activity(...times: readonly number[]): RecentActivity {
  return {
    posts: times.map((at, index) => ({
      postId: postId(`other-${String(index)}`),
      firstAt: at,
      lastAt: at,
    })),
  };
}

describe("checkPublishable: standing refusals, in order", () => {
  it("allows an active, disclosed account with nothing in the way", () => {
    expect(checkPublishable(anAccount(), post, T0, NONE)).toStrictEqual({ allowed: true });
  });

  it.each([
    ["PAUSED", "paused"],
    ["DISCONNECTED", "disconnected"],
    ["NEEDS_RECONNECT", "needs_reconnect"],
  ] as const)("%s → %s, before the disclosure check", (status: AccountStatus, reason) => {
    const account = anAccount({
      status,
      disclosure: { bioConfirmed: false, automatedLabelConfirmed: false },
    });
    expect(checkPublishable(account, post, T0, NONE)).toStrictEqual({ allowed: false, reason });
  });

  it("undisclosed before links", () => {
    const account = anAccount({
      disclosure: { bioConfirmed: true, automatedLabelConfirmed: false },
      policy: aPolicy({ linkPolicy: "REFUSE" }),
    });
    const linked = aPost({ parts: [part("see https://x.com")] });
    expect(checkPublishable(account, linked, T0, NONE)).toStrictEqual({
      allowed: false,
      reason: "undisclosed",
    });
  });

  it("link policy REFUSE refuses a scheme URL in any part, but not a bare domain", () => {
    const account = anAccount({ policy: aPolicy({ linkPolicy: "REFUSE" }) });
    const linked = aPost({ parts: [part("a"), part("see https://trymusechat.com")] });
    expect(checkPublishable(account, linked, T0, NONE)).toStrictEqual({
      allowed: false,
      reason: "link_policy",
    });
    const bare = aPost({ parts: [part("see trymusechat.com")] });
    expect(checkPublishable(account, bare, T0, NONE).allowed).toBe(true);
    expect(checkPublishable(anAccount(), linked, T0, NONE).allowed).toBe(true);
  });
});

describe("checkPublishable: timing", () => {
  it("quiet hours in the account's zone, before the cap", () => {
    const account = anAccount({
      policy: aPolicy({
        tz: "Asia/Tokyo",
        dailyCap: 1,
        quietHours: { startMinute: 21 * 60, endMinute: 22 * 60 },
      }),
    });
    // T0 is 12:00Z = 21:00 in Tokyo.
    expect(checkPublishable(account, post, T0, activity(T0 - HOUR))).toStrictEqual({
      allowed: false,
      reason: "quiet_hours",
    });
    expect(checkPublishable(account, post, T0 - 1, NONE).allowed).toBe(true);
  });

  it("the cap counts other posts whose first attempt is in today's local day", () => {
    const account = anAccount({ policy: aPolicy({ dailyCap: 2, minGap: 0 }) });
    const yesterday = Date.UTC(2026, 9, 26, 23, 59);
    expect(checkPublishable(account, post, T0, activity(T0 - HOUR)).allowed).toBe(true);
    expect(checkPublishable(account, post, T0, activity(T0 - HOUR, T0 - 2 * HOUR))).toStrictEqual({
      allowed: false,
      reason: "cap",
    });
    expect(checkPublishable(account, post, T0, activity(T0 - HOUR, yesterday)).allowed).toBe(true);
  });

  it("the post itself never counts against its own cap or gap (a thread's later parts)", () => {
    const account = anAccount({ policy: aPolicy({ dailyCap: 1, minGap: HOUR }) });
    const own: RecentActivity = { posts: [{ postId: post.id, firstAt: T0 - 1, lastAt: T0 - 1 }] };
    expect(checkPublishable(account, post, T0, own).allowed).toBe(true);
  });

  it("the gap is measured from the latest attempt of any other post", () => {
    const account = anAccount({ policy: aPolicy({ minGap: 30 * MINUTE }) });
    const recent: RecentActivity = {
      posts: [{ postId: postId("other"), firstAt: T0 - 2 * HOUR, lastAt: T0 - 29 * MINUTE }],
    };
    expect(checkPublishable(account, post, T0, recent)).toStrictEqual({
      allowed: false,
      reason: "gap",
    });
    expect(checkPublishable(account, post, T0 + MINUTE, recent).allowed).toBe(true);
  });
});

describe("activityOf", () => {
  it("first and last attempt over SENDING, SENT and UNKNOWN parts; others skipped", () => {
    const thread = aPost({
      id: postId("t"),
      parts: [
        part("a", sentState("x", T0 + 3)),
        part("b", unknownState(0, T0 + 9)),
        part("c", sendingState(T0 + 5)),
      ],
    });
    const idle = aPost({ id: postId("idle"), parts: [part("a")] });
    expect(activityOf([thread, idle])).toStrictEqual({
      posts: [{ postId: postId("t"), firstAt: T0 + 3, lastAt: T0 + 9 }],
    });
  });
});

describe("nextAllowedAt", () => {
  it("now when allowed; now + 1 min for a refusal no clock lifts", () => {
    expect(nextAllowedAt(anAccount(), post, T0, NONE)).toBe(T0);
    expect(nextAllowedAt(anAccount({ status: "PAUSED" }), post, T0, NONE)).toBe(
      T0 + STANDING_RETRY,
    );
    expect(STANDING_RETRY).toBe(MINUTE);
  });

  it("the end of the quiet hours", () => {
    const account = anAccount({
      policy: aPolicy({ quietHours: { startMinute: 11 * 60, endMinute: 13 * 60 } }),
    });
    expect(nextAllowedAt(account, post, T0, NONE)).toBe(T0 + HOUR);
  });

  it("the next local midnight when the cap is reached", () => {
    const account = anAccount({
      policy: aPolicy({ dailyCap: 1, minGap: 0, tz: "America/New_York" }),
    });
    // T0 = 08:00 in New York (EDT); the next local midnight is 04:00Z the next day.
    expect(nextAllowedAt(account, post, T0, activity(T0 - HOUR))).toBe(Date.UTC(2026, 9, 28, 4, 0));
  });

  it("the end of the gap", () => {
    const account = anAccount({ policy: aPolicy({ minGap: HOUR }) });
    expect(nextAllowedAt(account, post, T0, activity(T0 - 10 * MINUTE))).toBe(T0 + 50 * MINUTE);
  });

  it("chains refusals: the gap ends inside quiet hours, which end the next morning", () => {
    const account = anAccount({
      policy: aPolicy({
        minGap: 2 * HOUR,
        quietHours: { startMinute: 13 * 60, endMinute: 8 * 60 },
      }),
    });
    expect(nextAllowedAt(account, post, T0, activity(T0 - MINUTE))).toBe(
      Date.UTC(2026, 9, 28, 8, 0),
    );
  });

  it("gives up after eight steps and returns where it got to", () => {
    const account = anAccount({ policy: aPolicy({ dailyCap: 1, minGap: 0 }) });
    const everyDay = activity(...Array.from({ length: 12 }, (_, day) => T0 + day * DAY));
    expect(nextAllowedAt(account, post, T0, everyDay)).toBe(Date.UTC(2026, 10, 4));
  });
});

const zones = fc.constantFrom(...ZONES);
const quietHours = fc
  .record({
    startMinute: fc.integer({ min: 0, max: 1439 }),
    endMinute: fc.integer({ min: 0, max: 1439 }),
  })
  .filter((quiet) => quiet.startMinute !== quiet.endMinute);

describe("properties", () => {
  it("cap: with n other posts today, refused exactly when n ≥ dailyCap (any zone)", () => {
    fc.assert(
      fc.property(
        instants,
        zones,
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 8 }),
        (now, tz, cap, n) => {
          const account = anAccount({ policy: aPolicy({ tz, dailyCap: cap, minGap: 0 }) });
          const sameDay = Array.from({ length: n }, () => now);
          const decision = checkPublishable(account, post, now, activity(...sameDay));
          expect(decision.allowed).toBe(n < cap);
        },
      ),
    );
  });

  it("cap: posts from another local day never count", () => {
    fc.assert(
      fc.property(instants, zones, fc.integer({ min: 1, max: 48 }), (now, tz, hoursBack) => {
        const earlier = now - hoursBack * HOUR;
        fc.pre(localDayKey(earlier, tz) !== localDayKey(now, tz));
        const account = anAccount({ policy: aPolicy({ tz, dailyCap: 1, minGap: 0 }) });
        expect(checkPublishable(account, post, now, activity(earlier)).allowed).toBe(true);
      }),
    );
  });

  it("gap: refused exactly while now − last < minGap", () => {
    fc.assert(
      fc.property(
        instants,
        fc.integer({ min: 0, max: 5 * HOUR }),
        fc.integer({ min: 0, max: 5 * HOUR }),
        (now, gap, ago) => {
          const account = anAccount({ policy: aPolicy({ minGap: gap, dailyCap: 100 }) });
          const decision = checkPublishable(account, post, now, activity(now - ago));
          expect(decision.allowed).toBe(ago >= gap);
        },
      ),
    );
  });

  it("quiet hours: refused exactly when the local minute is inside the window, across DST", () => {
    fc.assert(
      fc.property(instants, zones, quietHours, (now, tz, quiet) => {
        const account = anAccount({ policy: aPolicy({ tz, quietHours: quiet }) });
        const minute = minuteOfDay(now, tz);
        const inside =
          quiet.startMinute < quiet.endMinute
            ? minute >= quiet.startMinute && minute < quiet.endMinute
            : minute >= quiet.startMinute || minute < quiet.endMinute;
        expect(checkPublishable(account, post, now, NONE).allowed).toBe(!inside);
      }),
    );
  });

  it("nextAllowedAt: never earlier than now, allowed there, and refused a minute before", () => {
    fc.assert(
      fc.property(instants, zones, quietHours, (now, tz, quiet) => {
        const account = anAccount({ policy: aPolicy({ tz, quietHours: quiet }) });
        const next = nextAllowedAt(account, post, now, NONE);
        expect(next).toBeGreaterThanOrEqual(now);
        expect(checkPublishable(account, post, next, NONE).allowed).toBe(true);
        if (next - MINUTE >= now) {
          expect(checkPublishable(account, post, next - MINUTE, NONE).allowed).toBe(false);
        }
      }),
    );
  });
});
