/** The accounts page grouped by person (GROKCHAT-16). */
import { describe, expect, it } from "vitest";
import { accountId, personId, xUserId } from "../../../../src/entities/identity/ids";
import {
  AccountsController,
  plural,
  tokenDate,
} from "../../../../src/interface_adapters/dashboard/accounts_controller";
import { ACCOUNT, anAccount, aPerson } from "../../support/builders";
import { dashboardUseCases } from "../../support/dashboard";
import { makeWorld } from "../../support/world";

const ORIGIN = "https://grokchat.test";

async function setup() {
  const world = makeWorld();
  await world.seedAccount();
  await world.accounts.save(
    anAccount({ id: accountId("acc-2"), xUserId: xUserId("x-user-2"), handle: "two" }),
  );
  return { world, controller: new AccountsController(dashboardUseCases(world)) };
}

describe("the accounts page, by person (GROKCHAT-16)", () => {
  it("a section per person by name, with their cards, token status and an Owner select; the rest unassigned", async () => {
    const { controller, world } = await setup();
    await world.accounts.save(anAccount({ id: accountId("acc-3"), xUserId: xUserId("x-3") }));
    await world.people.save(aPerson({ id: personId("p-k"), name: "Karl Michaud" }));
    await world.people.save(
      aPerson({
        id: personId("p-a"),
        name: "aaron",
        token: { sha256: "a".repeat(64), createdAt: Date.UTC(2026, 9, 27, 23, 59) },
      }),
    );
    await world.people.save(aPerson({ id: personId("p-z"), name: "Zed" }));
    await world.owners.assign(accountId("acc-3"), personId("p-k"));
    await world.owners.assign(ACCOUNT, personId("p-k"));
    await world.owners.assign(accountId("acc-2"), personId("p-a"));
    const outcome = await controller.accounts({ connected: null, origin: ORIGIN });
    if (outcome.kind !== "page") {
      throw new Error("no page");
    }
    const { people, unassigned, total } = outcome.view;
    expect(
      people.map(({ accounts, ...person }) => ({ ...person, ids: accounts.map((a) => a.id) })),
    ).toStrictEqual([
      {
        id: "p-a",
        name: "aaron",
        initials: "AA",
        tone: 1,
        count: "1 account",
        token: "Token set Oct 27, 2026",
        hasToken: true,
        issued: String(Date.UTC(2026, 9, 27, 23, 59)),
        ids: ["acc-2"],
      },
      {
        id: "p-k",
        name: "Karl Michaud",
        initials: "KM",
        tone: 2,
        count: "2 accounts",
        token: "No token",
        hasToken: false,
        issued: "none",
        ids: ["acc-1", "acc-3"],
      },
      {
        id: "p-z",
        name: "Zed",
        initials: "ZE",
        tone: 3,
        count: "0 accounts",
        token: "No token",
        hasToken: false,
        issued: "none",
        ids: [],
      },
    ]);
    expect([unassigned, total]).toStrictEqual([[], 3]);
    expect(people[1]?.accounts[0]?.owners).toStrictEqual([
      { value: "", label: "Unassigned", selected: false },
      { value: "p-a", label: "aaron", selected: false },
      { value: "p-k", label: "Karl Michaud", selected: true },
      { value: "p-z", label: "Zed", selected: false },
    ]);
    expect(people[0]?.accounts[0]?.badge).toMatchObject({ id: "acc-2", tone: 2 });
  });

  it("tones cycle after eight people", async () => {
    const { controller, world } = await setup();
    for (let index = 0; index < 9; index += 1) {
      await world.people.save(
        aPerson({ id: personId(`p-${String(index)}`), name: `P${String(index)}` }),
      );
    }
    const outcome = await controller.accounts({ connected: null, origin: ORIGIN });
    expect(outcome.kind === "page" ? outcome.view.people.map((p) => p.tone) : []).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 1,
    ]);
    expect(tokenDate(Date.UTC(2027, 0, 5))).toBe("Jan 5, 2027");
    expect(plural(1, "a", "b")).toBe("1 a");
  });
});
