import { describe, expect, it } from "vitest";
import { disclosureComplete } from "../../../../src/entities/accounts/account";
import {
  DEFAULT_POLICY,
  inQuietHours,
  validatePolicy,
} from "../../../../src/entities/accounts/posting_policy";
import { MINUTE } from "../../../../src/entities/time/instant";
import { aPolicy } from "../../support/builders";

describe("validatePolicy", () => {
  it("accepts the default policy and its documented values", () => {
    expect(DEFAULT_POLICY).toStrictEqual({
      mode: "AUTO",
      dailyCap: 10,
      minGap: 30 * MINUTE,
      quietHours: null,
      tz: "UTC",
      linkPolicy: "REFUSE",
      grace: 30 * MINUTE,
    });
    expect(validatePolicy(DEFAULT_POLICY)).toStrictEqual({ allowed: true });
    expect(validatePolicy(aPolicy({ dailyCap: 1, minGap: 0, grace: 0 })).allowed).toBe(true);
    expect(
      validatePolicy(aPolicy({ quietHours: { startMinute: 0, endMinute: 1439 } })).allowed,
    ).toBe(true);
  });

  it.each([
    ["daily_cap", { dailyCap: 0 }],
    ["daily_cap", { dailyCap: 1.5 }],
    ["min_gap", { minGap: -1 }],
    ["min_gap", { minGap: 0.5 }],
    ["quiet_hours", { quietHours: { startMinute: 60, endMinute: 60 } }],
    ["quiet_hours", { quietHours: { startMinute: -1, endMinute: 60 } }],
    ["quiet_hours", { quietHours: { startMinute: 0, endMinute: 1440 } }],
    ["quiet_hours", { quietHours: { startMinute: 1440, endMinute: 0 } }],
    ["quiet_hours", { quietHours: { startMinute: 0.5, endMinute: 60 } }],
    ["quiet_hours", { quietHours: { startMinute: 0, endMinute: 59.5 } }],
    ["tz", { tz: "Nowhere/Land" }],
    ["grace", { grace: -1 }],
    ["grace", { grace: 1.5 }],
  ] as const)("refuses %s for %j", (reason, overrides) => {
    expect(validatePolicy(aPolicy(overrides))).toStrictEqual({ allowed: false, reason });
  });
});

describe("inQuietHours", () => {
  it("equal ends: never quiet", () => {
    expect(inQuietHours({ startMinute: 60, endMinute: 60 }, 60)).toBe(false);
    expect(inQuietHours({ startMinute: 60, endMinute: 60 }, 0)).toBe(false);
  });

  it("a daytime window is [start, end)", () => {
    const quiet = { startMinute: 60, endMinute: 120 };
    expect([59, 60, 119, 120].map((minute) => inQuietHours(quiet, minute))).toStrictEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("a window over midnight wraps", () => {
    const quiet = { startMinute: 22 * 60, endMinute: 7 * 60 };
    expect([1319, 1320, 0, 419, 420].map((minute) => inQuietHours(quiet, minute))).toStrictEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });
});

describe("disclosureComplete", () => {
  it("needs both the bio and the automated label", () => {
    expect(disclosureComplete({ bioConfirmed: true, automatedLabelConfirmed: true })).toBe(true);
    expect(disclosureComplete({ bioConfirmed: true, automatedLabelConfirmed: false })).toBe(false);
    expect(disclosureComplete({ bioConfirmed: false, automatedLabelConfirmed: true })).toBe(false);
  });
});
