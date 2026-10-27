import { describe, expect, it } from "vitest";
import {
  DISPATCH_COST,
  FANOUT_CEILING,
  fits,
  INVOCATION_LIMITS,
  invocationBudget,
  partCost,
  spend,
  TOKEN_REFRESH_COST,
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

  it("the fan-out ceiling and the per-dispatch and refresh costs", () => {
    expect(FANOUT_CEILING).toBe(200);
    expect(DISPATCH_COST).toStrictEqual({ cloudflareCalls: 1, externalSubrequests: 0, millis: 0 });
    expect(TOKEN_REFRESH_COST).toStrictEqual({
      cloudflareCalls: 0,
      externalSubrequests: 1,
      millis: 5 * SECOND,
    });
  });

  it("a part's worst case grows with its media", () => {
    expect(partCost([])).toStrictEqual({
      cloudflareCalls: 5,
      externalSubrequests: 1,
      millis: 2 * SECOND,
    });
    expect(partCost(["PHOTO", "PHOTO"])).toStrictEqual({
      cloudflareCalls: 15,
      externalSubrequests: 3,
      millis: 4 * SECOND,
    });
    expect(partCost(["GIF"])).toStrictEqual({
      cloudflareCalls: 10,
      externalSubrequests: 12,
      millis: 7 * SECOND,
    });
  });

  it("the worst thread part fits one invocation many times over", () => {
    const worst = partCost(["PHOTO", "PHOTO", "PHOTO", "PHOTO"]);
    expect(fits(invocationBudget(T0 + 60 * SECOND), worst, T0)).toBe(true);
  });
});
