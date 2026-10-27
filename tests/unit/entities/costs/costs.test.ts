import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  estimateCost,
  PRICES,
  type XOperation,
} from "../../../../src/entities/costs/estimate_cost";
import { totalCosts, type CostEntry } from "../../../../src/entities/records/cost_entry";
import { ACCOUNT, T0 } from "../../support/builders";

describe("estimateCost (plan §1.1, U4)", () => {
  it("documents X's prices in micro-dollars", () => {
    expect(PRICES).toStrictEqual({
      create: 15_000,
      createWithUrl: 200_000,
      delete: 10_000,
      read: 5_000,
      ownedRead: 1_000,
    });
  });

  it.each([
    [{ kind: "create", text: "plain" }, false, { kind: "usd", micros: 15_000 }],
    [{ kind: "create", text: "bare trymusechat.com" }, false, { kind: "usd", micros: 15_000 }],
    [
      { kind: "create", text: "see https://trymusechat.com" },
      false,
      { kind: "usd", micros: 200_000 },
    ],
    [
      { kind: "create", text: "see https://trymusechat.com" },
      true,
      { kind: "usd", micros: 200_000 },
    ],
    [{ kind: "delete" }, false, { kind: "usd", micros: 10_000 }],
    [{ kind: "read", resources: 3 }, false, { kind: "usd", micros: 15_000 }],
    [{ kind: "read", resources: 3 }, true, { kind: "usd", micros: 3_000 }],
    [{ kind: "media_upload" }, false, { kind: "unknown" }],
    [{ kind: "oauth" }, false, { kind: "usd", micros: 0 }],
  ] as const)("%j (app owner: %s) → %j", (operation: XOperation, owner, expected) => {
    expect(estimateCost(operation, owner)).toStrictEqual(expected);
  });

  it("property: a create costs $0.20 exactly when it carries a scheme URL", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom("", "https://a.co ", "http://b.io/x "),
        fc.boolean(),
        (text, link, owner) => {
          const estimate = estimateCost(
            { kind: "create", text: `${link}${text.replace(/[:/.]/g, " ")}` },
            owner,
          );
          expect(estimate).toStrictEqual({ kind: "usd", micros: link === "" ? 15_000 : 200_000 });
        },
      ),
    );
  });

  it("property: reads are linear in resources and owned reads are never dearer", () => {
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), fc.nat({ max: 1000 }), fc.boolean(), (a, b, owner) => {
        const micros = (n: number, isOwner: boolean): number => {
          const estimate = estimateCost({ kind: "read", resources: n }, isOwner);
          return estimate.kind === "usd" ? estimate.micros : Number.NaN;
        };
        expect(micros(a + b, owner)).toBe(micros(a, owner) + micros(b, owner));
        expect(micros(a, true)).toBeLessThanOrEqual(micros(a, false));
      }),
    );
  });
});

describe("totalCosts", () => {
  it("sums priced entries and counts unknown ones without guessing", () => {
    const entry = (estimate: CostEntry["estimate"]): CostEntry => ({
      at: T0,
      accountId: ACCOUNT,
      operation: "create",
      estimate,
    });
    expect(
      totalCosts([
        entry({ kind: "usd", micros: 15_000 }),
        entry({ kind: "unknown" }),
        entry({ kind: "usd", micros: 5 }),
      ]),
    ).toStrictEqual({ micros: 15_005, calls: 3, unknownPriced: 1 });
    expect(totalCosts([])).toStrictEqual({ micros: 0, calls: 0, unknownPriced: 0 });
  });
});
