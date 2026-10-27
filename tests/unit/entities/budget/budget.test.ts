import { describe, expect, it } from "vitest";
import {
  DISPATCH_COST,
  FANOUT_CEILING,
  fits,
  INVOCATION_LIMITS,
  invocationBudget,
  METRICS_READ_COST,
  partCost,
  partCostForMediaCount,
  RECONCILE_CHECK_COST,
  spend,
  TOKEN_REFRESH_MILLIS,
  TOKEN_STEP_CALLS,
  TOKEN_STEP_COST,
} from "../../../../src/entities/budget/budget";
import { SECOND } from "../../../../src/entities/time/instant";
import { T0 } from "../../support/builders";

describe("Budget (U16)", () => {
  it("an invocation has 1,000 Cloudflare-service calls and 50 external fetches", () => {
    expect(INVOCATION_LIMITS).toStrictEqual({ cloudflareCalls: 1000, externalSubrequests: 50 });
    expect(invocationBudget(T0)).toStrictEqual({
      deadline: T0,
      cloudflareCalls: 1000,
      externalSubrequests: 50,
    });
  });

  it("fits only when the deadline and both pools allow it, each at its boundary", () => {
    const budget = { deadline: T0 + 10, cloudflareCalls: 5, externalSubrequests: 2 };
    expect(fits(budget, { cloudflareCalls: 5, externalSubrequests: 2, millis: 10 }, T0)).toBe(true);
    expect(fits(budget, { cloudflareCalls: 5, externalSubrequests: 2, millis: 11 }, T0)).toBe(
      false,
    );
    expect(fits(budget, { cloudflareCalls: 6, externalSubrequests: 2, millis: 0 }, T0)).toBe(false);
    expect(fits(budget, { cloudflareCalls: 0, externalSubrequests: 3, millis: 0 }, T0)).toBe(false);
  });

  it("spend takes from both pools and keeps the deadline", () => {
    expect(
      spend(invocationBudget(T0), { cloudflareCalls: 3, externalSubrequests: 1 }),
    ).toStrictEqual({
      deadline: T0,
      cloudflareCalls: 997,
      externalSubrequests: 49,
    });
  });

  it("the fan-out ceiling and the fixed step costs", () => {
    expect(FANOUT_CEILING).toBe(200);
    expect(DISPATCH_COST).toStrictEqual({ cloudflareCalls: 1, externalSubrequests: 0, millis: 0 });
    expect(TOKEN_STEP_COST).toStrictEqual({
      cloudflareCalls: 4,
      externalSubrequests: 1,
      millis: TOKEN_REFRESH_MILLIS,
    });
    expect(TOKEN_REFRESH_MILLIS).toBe(60 * SECOND);
    expect(TOKEN_STEP_CALLS).toStrictEqual({ ...TOKEN_STEP_COST, millis: 0 });
    const read = { cloudflareCalls: 3, externalSubrequests: 1, millis: 2 * SECOND };
    expect(RECONCILE_CHECK_COST).toStrictEqual({ ...read, cloudflareCalls: 4 });
    expect(METRICS_READ_COST).toStrictEqual(read);
  });

  it("a part's worst case grows with its media", () => {
    expect(partCost([])).toStrictEqual({
      cloudflareCalls: 5,
      externalSubrequests: 1,
      millis: 2 * SECOND,
    });
    expect(partCost(["PHOTO", "PHOTO"])).toStrictEqual({
      cloudflareCalls: 17,
      externalSubrequests: 3,
      millis: 4 * SECOND,
    });
    expect(partCost(["GIF"])).toStrictEqual({
      cloudflareCalls: 11,
      externalSubrequests: 12,
      millis: 7 * SECOND,
    });
  });

  it("the worst case by media count: a single item may be a GIF, several are photos", () => {
    expect(partCostForMediaCount(0)).toStrictEqual(partCost([]));
    expect(partCostForMediaCount(1)).toStrictEqual(partCost(["GIF"]));
    expect(partCostForMediaCount(3)).toStrictEqual(partCost(["PHOTO", "PHOTO", "PHOTO"]));
  });

  it("the worst thread part fits one invocation many times over", () => {
    const worst = partCost(["PHOTO", "PHOTO", "PHOTO", "PHOTO"]);
    expect(fits(invocationBudget(T0 + 60 * SECOND), worst, T0)).toBe(true);
  });
});
