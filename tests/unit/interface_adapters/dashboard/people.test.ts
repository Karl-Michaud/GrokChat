/** The people controller and the setup prompt (GROKCHAT-16), over the in-memory world. */
import { describe, expect, it } from "vitest";
import { accountId, personId, xUserId } from "../../../../src/entities/identity/ids";
import {
  CONNECTOR_NAME,
  PeopleController,
} from "../../../../src/interface_adapters/dashboard/people_controller";
import { setupPrompt, wrapList } from "../../../../src/interface_adapters/dashboard/setup_prompt";
import { tokenDate } from "../../../../src/interface_adapters/dashboard/accounts_controller";
import {
  issuedField,
  NO_TOKEN,
  parseIssued,
} from "../../../../src/interface_adapters/dashboard/token_form";
import { TOOL_NAMES } from "../../../../src/interface_adapters/mcp/tool_catalog";
import { ACCOUNT, anAccount, aPerson, PERSON, T0 } from "../../support/builders";
import { dashboardUseCases, presenting } from "../../support/dashboard";
import { makeWorld } from "../../support/world";

const ORIGIN = "https://grokchat.test";
const REDIRECT = { kind: "redirect", location: "/dashboard/accounts" };

async function setup() {
  const world = makeWorld();
  await world.seedAccount();
  await world.accounts.save(
    anAccount({ id: accountId("acc-2"), xUserId: xUserId("x-2"), handle: "two" }),
  );
  return { world, people: new PeopleController(dashboardUseCases(world)) };
}

describe("PeopleController", () => {
  it("creates, renames and deletes a person, redirecting to the accounts page", async () => {
    const { world, people } = await setup();
    expect(await people.create(" Karl ")).toStrictEqual(REDIRECT);
    const [karl] = await world.people.list();
    expect(karl?.name).toBe("Karl");
    const id = karl?.id ?? "";
    expect(await people.rename(id, "Karl M")).toStrictEqual(REDIRECT);
    expect((await world.people.get(personId(id)))?.name).toBe("Karl M");
    expect(await people.remove(id, "karl m")).toStrictEqual(REDIRECT);
    expect(await world.people.list()).toStrictEqual([]);
  });

  it("shows each refusal with its status and message", async () => {
    const { world, people } = await setup();
    await world.people.save(aPerson());
    expect(await people.create("")).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "A name is 1 to 60 characters.",
    });
    expect(await people.create("KARL")).toStrictEqual({
      kind: "refused",
      status: 409,
      message: "Someone already has that name.",
    });
    expect(await people.remove(PERSON, "Kar")).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "Type the person's name exactly to delete them.",
    });
    expect(await people.assign("acc-1", "ghost")).toStrictEqual({
      kind: "refused",
      status: 404,
      message: "That person does not exist.",
    });
    expect(await people.rename("ghost", "X")).toMatchObject({ status: 404 });
    expect(await people.token("ghost", ORIGIN, "none")).toMatchObject({
      kind: "refused",
      status: 404,
    });
  });

  it("assigns from the Owner select, '' unassigning", async () => {
    const { world, people } = await setup();
    await world.people.save(aPerson());
    expect(await people.assign("acc-2", PERSON)).toStrictEqual(REDIRECT);
    expect(await world.owners.accountsOf(PERSON)).toStrictEqual(["acc-2"]);
    expect(await people.assign("acc-2", "")).toStrictEqual(REDIRECT);
    expect(await world.owners.list()).toStrictEqual([]);
  });

  it("the token panel: the token once, the connector settings and a prompt without the token", async () => {
    const { world, people } = await setup();
    await world.people.save(aPerson());
    await world.owners.assign(ACCOUNT, PERSON);
    const outcome = await people.token(PERSON, ORIGIN, "none");
    if (outcome.kind !== "page" || outcome.view.kind !== "issued") {
      throw new Error("refused");
    }
    const view = outcome.view.view;
    expect(view).toStrictEqual({
      personName: "Karl",
      rotated: false,
      token: view.token,
      connectorName: "grokchat",
      mcpUrl: "https://grokchat.test/mcp",
      authorization: `Bearer ${view.token}`,
      accounts: [{ handle: "musechat_one", id: "acc-1" }],
      prompt: setupPrompt({
        personName: "Karl",
        accounts: [{ handle: "musechat_one", id: "acc-1" }],
        mcpUrl: "https://grokchat.test/mcp",
        dashboardUrl: "https://grokchat.test/dashboard",
      }),
    });
    expect(view.token).toMatch(/^token-1-/);
    expect(view.prompt).not.toContain(view.token);
    expect(CONNECTOR_NAME).toBe("grokchat");
    const again = await people.token(PERSON, ORIGIN, String(T0));
    expect(again).toMatchObject({
      kind: "page",
      view: { kind: "issued", view: { rotated: true } },
    });
  });

  it("a refused issue shows the refusal", async () => {
    const { world } = await setup();
    const refusing = new PeopleController({
      ...dashboardUseCases(world),
      issueToken: presenting({ ok: false, code: "human_only" }),
    });
    expect(await refusing.token(PERSON, ORIGIN, "none")).toStrictEqual({
      kind: "refused",
      status: 403,
      message: "Only the dashboard's owner may do this.",
    });
  });
});

describe("the token form's issued field (GROKCHAT-18)", () => {
  it("a reload of an issued form asks instead of rotating, naming the current token", async () => {
    const { world, people } = await setup();
    await world.people.save(aPerson());
    expect(await people.token(PERSON, ORIGIN, "none")).toMatchObject({ view: { kind: "issued" } });
    expect(await people.token(PERSON, ORIGIN, "none")).toStrictEqual({
      kind: "page",
      view: {
        kind: "stale",
        view: {
          personId: PERSON,
          personName: "Karl",
          current: `Token set ${tokenDate(T0)}`,
          issued: String(T0),
        },
      },
    });
  });

  it("a stale form for a person whose token was revoked offers a first token", async () => {
    const { world } = await setup();
    const refusing = new PeopleController({
      ...dashboardUseCases(world),
      issueToken: presenting({ ok: false, code: "token_already_issued", person: aPerson() }),
    });
    expect(await refusing.token(PERSON, ORIGIN, "1")).toMatchObject({
      view: { kind: "stale", view: { current: "No token", issued: "none" } },
    });
  });

  it("issuedField and parseIssued round-trip; anything else is no expectation", () => {
    expect(issuedField(null)).toBe(NO_TOKEN);
    expect(NO_TOKEN).toBe("none");
    expect(issuedField(T0)).toBe(String(T0));
    expect(parseIssued("none")).toStrictEqual({ createdAt: null });
    expect(parseIssued(String(T0))).toStrictEqual({ createdAt: T0 });
    expect(parseIssued("0")).toStrictEqual({ createdAt: 0 });
    expect(parseIssued("999999999999999")).toStrictEqual({ createdAt: 999999999999999 });
    for (const junk of ["", "x", "1.5", "-1", " 1", "1 ", "1e3", "1000000000000000", "None"]) {
      expect(parseIssued(junk)).toBeNull();
    }
  });
});

describe("the setup prompt", () => {
  const input = {
    personName: "Aaron",
    accounts: [
      { handle: "aaron_builds", id: "acc-a" },
      { handle: "aaron_jokes", id: "acc-b" },
    ],
    mcpUrl: "https://grokchat.test/mcp",
    dashboardUrl: "https://grokchat.test/dashboard",
  };

  it("matches the reviewed text", async () => {
    await expect(setupPrompt(input)).toMatchFileSnapshot("__snapshots__/setup_prompt.txt");
  });

  it("names the person's accounts, every tool, and says the token never changes", () => {
    const prompt = setupPrompt(input);
    expect(prompt).toContain("     @aaron_builds   acc-a\n     @aaron_jokes   acc-b");
    expect(prompt).toContain("server_url:    https://grokchat.test/mcp");
    expect(prompt).toContain("(usually on the dashboard at https://grokchat.test/dashboard,");
    expect(prompt).toContain(`There should be\n   ${String(TOOL_NAMES.length)}:\n   create_post,`);
    for (const name of TOOL_NAMES) {
      expect(prompt).toMatch(new RegExp(` ${name}[,.]`));
    }
    const listed = prompt.slice(prompt.indexOf(":\n   create_post"), prompt.indexOf("Tell me if"));
    const widths = listed.split("\n").map((line) => line.length);
    expect(Math.max(...widths)).toBeLessThanOrEqual(90);
    expect(Math.max(...widths)).toBeGreaterThan(80);
    expect(listed.trim().endsWith(".")).toBe(true);
    expect(prompt).toContain("Call grokchat___list_accounts.");
    expect(prompt).toContain("so it NEVER changes when\nan account is added");
    expect(prompt).toContain("set its Owner to Aaron");
    expect(prompt).not.toMatch(/token,? which I put in your config|old one stops working/);
  });

  it("wraps a list at the width exactly", () => {
    // "   ab, cd," is 10 characters: it fits a width of 10, not of 9.
    expect(wrapList(["ab", "cd", "ef"], 10)).toBe("   ab, cd,\n   ef.");
    expect(wrapList(["ab", "cd", "ef"], 9)).toBe("   ab,\n   cd,\n   ef.");
    expect(wrapList(["ab"], 3)).toBe("   ab.");
  });

  it("with no account yet, says to assign one first", () => {
    expect(setupPrompt({ ...input, accounts: [] })).toContain(
      "(none assigned yet: ask me to assign one on the GrokChat dashboard first)",
    );
  });
});
