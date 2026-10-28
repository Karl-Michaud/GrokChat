/** The people use cases (GROKCHAT-16): human only, audited, never a token in the audit. */
import { describe, expect, it, vi } from "vitest";
import { accountId, personId, xUserId } from "../../../src/entities/identity/ids";
import { AssignAccountInteractor } from "../../../src/use_cases/assign_account/interactor";
import type { AssignAccountOutputData } from "../../../src/use_cases/assign_account/output_data";
import { CreatePersonInteractor } from "../../../src/use_cases/create_person/interactor";
import type { CreatePersonOutputData } from "../../../src/use_cases/create_person/output_data";
import { DeletePersonInteractor } from "../../../src/use_cases/delete_person/interactor";
import type { DeletePersonOutputData } from "../../../src/use_cases/delete_person/output_data";
import { IssuePersonTokenInteractor } from "../../../src/use_cases/issue_person_token/interactor";
import type { IssuePersonTokenOutputData } from "../../../src/use_cases/issue_person_token/output_data";
import { ListOwnAccountsInteractor } from "../../../src/use_cases/list_own_accounts/interactor";
import type { ListOwnAccountsOutputData } from "../../../src/use_cases/list_own_accounts/output_data";
import { ListPeopleInteractor } from "../../../src/use_cases/list_people/interactor";
import type { ListPeopleOutputData } from "../../../src/use_cases/list_people/output_data";
import { RenamePersonInteractor } from "../../../src/use_cases/rename_person/interactor";
import type { RenamePersonOutputData } from "../../../src/use_cases/rename_person/output_data";
import {
  ACCOUNT,
  anAccount,
  aPerson,
  botActor,
  HUMAN,
  OTHER_ACCOUNT,
  PERSON,
  SYSTEM,
  T0,
} from "../support/builders";
import { Capture, makeWorld, type World } from "../support/world";

const ports = (world: World) => ({ ...world, audit: world.actionAudit });

const audited = (world: World) =>
  world.audit.events.map((event) => [event.actor, event.action, event.accountId, event.detail]);

const HUMAN_ONLY = { ok: false, code: "human_only" } as const;

async function withTwoAccounts(world: World) {
  await world.accounts.save(anAccount());
  await world.accounts.save(anAccount({ id: OTHER_ACCOUNT, xUserId: xUserId("x-2") }));
}

describe("createPerson", () => {
  it("creates a person with a fresh id, the clock's time and no token, and audits it", async () => {
    const world = makeWorld();
    const presenter = new Capture<CreatePersonOutputData>();
    await new CreatePersonInteractor(ports(world), presenter).execute({
      actor: HUMAN,
      name: "  Karl   M ",
    });
    const person = { id: personId("id-1"), name: "Karl M", createdAt: T0, token: null };
    expect(presenter.last).toStrictEqual({ ok: true, person });
    expect(await world.people.list()).toStrictEqual([person]);
    expect(audited(world)).toStrictEqual([["human:owner", "person.create", null, "person id-1"]]);
  });

  it("refuses bots and the system (audited), bad names, and a name taken in any ASCII case", async () => {
    const world = makeWorld();
    await world.people.save(aPerson({ name: "Karl" }));
    const presenter = new Capture<CreatePersonOutputData>();
    const create = new CreatePersonInteractor(ports(world), presenter);
    await create.execute({ actor: botActor(), name: "Bot" });
    expect(presenter.last).toStrictEqual(HUMAN_ONLY);
    await create.execute({ actor: SYSTEM, name: "Cron" });
    expect(presenter.last).toStrictEqual(HUMAN_ONLY);
    await create.execute({ actor: HUMAN, name: "   " });
    expect(presenter.last).toStrictEqual({ ok: false, code: "invalid_name" });
    await create.execute({ actor: HUMAN, name: "kARL" });
    expect(presenter.last).toStrictEqual({ ok: false, code: "name_taken" });
    expect(await world.people.list()).toHaveLength(1);
    expect(audited(world)).toStrictEqual([
      ["bot:bot-1", "refused.person.create", null, "human_only"],
      ["system:cron", "refused.person.create", null, "human_only"],
    ]);
  });
});

describe("renamePerson", () => {
  it("renames, keeping the id, token and creation time; its own name in another case is fine", async () => {
    const world = makeWorld();
    const token = { sha256: "a".repeat(64), createdAt: T0 - 1 };
    await world.people.save(aPerson({ token, createdAt: T0 - 5 }));
    const presenter = new Capture<RenamePersonOutputData>();
    const rename = new RenamePersonInteractor(ports(world), presenter);
    await rename.execute({ actor: HUMAN, personId: PERSON, name: " KARL " });
    const renamed = { id: PERSON, name: "KARL", createdAt: T0 - 5, token };
    expect(presenter.last).toStrictEqual({ ok: true, person: renamed });
    expect(await world.people.get(PERSON)).toStrictEqual(renamed);
    expect(audited(world)).toStrictEqual([
      ["human:owner", "person.rename", null, "person person-1"],
    ]);
  });

  it("refuses bots, an unknown person, a bad name and another person's name", async () => {
    const world = makeWorld();
    await world.people.save(aPerson());
    await world.people.save(aPerson({ id: personId("p-2"), name: "Aaron" }));
    const presenter = new Capture<RenamePersonOutputData>();
    const rename = new RenamePersonInteractor(ports(world), presenter);
    await rename.execute({ actor: botActor(), personId: PERSON, name: "X" });
    expect(presenter.last).toStrictEqual(HUMAN_ONLY);
    await rename.execute({ actor: HUMAN, personId: personId("nobody"), name: "X" });
    expect(presenter.last).toStrictEqual({ ok: false, code: "not_found" });
    await rename.execute({ actor: HUMAN, personId: PERSON, name: "" });
    expect(presenter.last).toStrictEqual({ ok: false, code: "invalid_name" });
    await rename.execute({ actor: HUMAN, personId: PERSON, name: "aaron" });
    expect(presenter.last).toStrictEqual({ ok: false, code: "name_taken" });
    expect((await world.people.get(PERSON))?.name).toBe("Karl");
    expect(audited(world)).toStrictEqual([
      ["bot:bot-1", "refused.person.rename", null, "human_only"],
    ]);
  });
});

describe("deletePerson", () => {
  it("needs the name typed again (any ASCII case, spaces collapsed), then unassigns and revokes", async () => {
    const world = makeWorld();
    await withTwoAccounts(world);
    const person = aPerson({ name: "Karl M", token: { sha256: "a".repeat(64), createdAt: T0 } });
    await world.people.save(person);
    await world.owners.assign(ACCOUNT, PERSON);
    const presenter = new Capture<DeletePersonOutputData>();
    const remove = new DeletePersonInteractor(ports(world), presenter);
    for (const confirmation of ["", "Karl", "Karl MM"]) {
      await remove.execute({ actor: HUMAN, personId: PERSON, confirmation });
      expect(presenter.last).toStrictEqual({ ok: false, code: "name_mismatch" });
    }
    expect(await world.people.get(PERSON)).not.toBeNull();
    await remove.execute({ actor: HUMAN, personId: PERSON, confirmation: " karl   m " });
    expect(presenter.last).toStrictEqual({ ok: true, person });
    expect(await world.people.get(PERSON)).toBeNull();
    expect(await world.people.findByTokenHash("a".repeat(64))).toBeNull();
    expect(await world.owners.list()).toStrictEqual([]);
    expect(await world.accounts.get(ACCOUNT)).not.toBeNull();
    expect(audited(world)).toStrictEqual([
      ["human:owner", "person.delete", null, "person person-1"],
    ]);
  });

  it("refuses bots and an unknown person", async () => {
    const world = makeWorld();
    await world.people.save(aPerson());
    const presenter = new Capture<DeletePersonOutputData>();
    const remove = new DeletePersonInteractor(ports(world), presenter);
    await remove.execute({ actor: botActor(), personId: PERSON, confirmation: "Karl" });
    expect(presenter.last).toStrictEqual(HUMAN_ONLY);
    await remove.execute({ actor: HUMAN, personId: personId("x"), confirmation: "Karl" });
    expect(presenter.last).toStrictEqual({ ok: false, code: "not_found" });
    expect(await world.people.get(PERSON)).not.toBeNull();
    expect(audited(world)).toStrictEqual([
      ["bot:bot-1", "refused.person.delete", null, "human_only"],
    ]);
  });
});

describe("assignAccount", () => {
  it("assigns, moves and unassigns an account, auditing each against the account", async () => {
    const world = makeWorld();
    await withTwoAccounts(world);
    await world.people.save(aPerson());
    await world.people.save(aPerson({ id: personId("p-2"), name: "Aaron" }));
    const presenter = new Capture<AssignAccountOutputData>();
    const assign = new AssignAccountInteractor(ports(world), presenter);
    await assign.execute({ actor: HUMAN, accountId: ACCOUNT, personId: PERSON });
    expect(presenter.last).toStrictEqual({ ok: true });
    expect(await world.owners.accountsOf(PERSON)).toStrictEqual([ACCOUNT]);
    await assign.execute({ actor: HUMAN, accountId: ACCOUNT, personId: personId("p-2") });
    expect(await world.owners.accountsOf(PERSON)).toStrictEqual([]);
    expect(await world.owners.accountsOf(personId("p-2"))).toStrictEqual([ACCOUNT]);
    await assign.execute({ actor: HUMAN, accountId: ACCOUNT, personId: null });
    expect(await world.owners.list()).toStrictEqual([]);
    expect(audited(world)).toStrictEqual([
      ["human:owner", "person.assign", ACCOUNT, "person person-1"],
      ["human:owner", "person.assign", ACCOUNT, "person p-2"],
      ["human:owner", "person.assign", ACCOUNT, "unassigned"],
    ]);
  });

  it("refuses bots, an unknown account and an unknown person, changing nothing", async () => {
    const world = makeWorld();
    await withTwoAccounts(world);
    await world.people.save(aPerson());
    const presenter = new Capture<AssignAccountOutputData>();
    const assign = new AssignAccountInteractor(ports(world), presenter);
    await assign.execute({ actor: botActor(), accountId: ACCOUNT, personId: PERSON });
    expect(presenter.last).toStrictEqual(HUMAN_ONLY);
    await assign.execute({ actor: HUMAN, accountId: accountId("ghost"), personId: PERSON });
    expect(presenter.last).toStrictEqual({ ok: false, code: "not_found" });
    await assign.execute({ actor: HUMAN, accountId: ACCOUNT, personId: personId("ghost") });
    expect(presenter.last).toStrictEqual({ ok: false, code: "person_not_found" });
    await assign.execute({ actor: HUMAN, accountId: accountId("ghost"), personId: null });
    expect(presenter.last).toStrictEqual({ ok: false, code: "not_found" });
    expect(await world.owners.list()).toStrictEqual([]);
    expect(audited(world)).toStrictEqual([
      ["bot:bot-1", "refused.person.assign", ACCOUNT, "human_only"],
    ]);
  });
});

describe("issuePersonToken", () => {
  it("generates, then rotates: only the new hash is kept, and the audit never has the token", async () => {
    const world = makeWorld();
    await withTwoAccounts(world);
    await world.accounts.save(anAccount({ id: accountId("acc-3"), xUserId: xUserId("x-3") }));
    await world.people.save(aPerson({ createdAt: T0 - 9 }));
    await world.owners.assign(OTHER_ACCOUNT, PERSON);
    await world.owners.assign(ACCOUNT, PERSON);
    const presenter = new Capture<IssuePersonTokenOutputData>();
    const issue = new IssuePersonTokenInteractor({ ...ports(world) }, presenter);
    await issue.execute({ actor: HUMAN, personId: PERSON, expected: { createdAt: null } });
    const first = presenter.last;
    if (!first.ok) {
      throw new Error("refused");
    }
    expect(first.rotated).toBe(false);
    expect(first.token).toMatch(/^token-1-x+$/);
    expect(first.accounts.map((account) => account.id)).toStrictEqual([ACCOUNT, OTHER_ACCOUNT]);
    const hash = first.person.token?.sha256 ?? "";
    expect(first.person).toStrictEqual({
      id: PERSON,
      name: "Karl",
      createdAt: T0 - 9,
      token: { sha256: hash, createdAt: T0 },
    });
    expect(await world.people.findByTokenHash(hash)).toStrictEqual(first.person);
    world.clock.advance(1000);
    await issue.execute({ actor: HUMAN, personId: PERSON, expected: { createdAt: T0 } });
    const second = presenter.last;
    if (!second.ok) {
      throw new Error("refused");
    }
    expect(second.rotated).toBe(true);
    expect(second.token).not.toBe(first.token);
    expect(second.person.token?.createdAt).toBe(T0 + 1000);
    expect(await world.people.findByTokenHash(hash)).toBeNull();
    expect(audited(world)).toStrictEqual([
      ["human:owner", "person.token", null, "person person-1 generated"],
      ["human:owner", "person.token", null, "person person-1 rotated"],
    ]);
    const everything = JSON.stringify(world.audit.events);
    expect(everything).not.toContain(first.token);
    expect(everything).not.toContain(second.token);
    expect(everything).not.toContain(hash);
  });

  it("skips an assigned account that no longer exists", async () => {
    const world = makeWorld();
    await withTwoAccounts(world);
    await world.people.save(aPerson());
    await world.owners.assign(ACCOUNT, PERSON);
    world.accounts.rows.delete(ACCOUNT);
    const presenter = new Capture<IssuePersonTokenOutputData>();
    await new IssuePersonTokenInteractor(ports(world), presenter).execute({
      actor: HUMAN,
      personId: PERSON,
      expected: { createdAt: null },
    });
    expect(presenter.last).toMatchObject({ ok: true, accounts: [] });
  });

  it("refuses bots and an unknown person, issuing nothing", async () => {
    const world = makeWorld();
    await world.people.save(aPerson());
    const presenter = new Capture<IssuePersonTokenOutputData>();
    const issue = new IssuePersonTokenInteractor(ports(world), presenter);
    const expected = { createdAt: null };
    await issue.execute({ actor: botActor(), personId: PERSON, expected });
    expect(presenter.last).toStrictEqual(HUMAN_ONLY);
    await issue.execute({ actor: HUMAN, personId: personId("ghost"), expected });
    expect(presenter.last).toStrictEqual({ ok: false, code: "not_found" });
    expect((await world.people.get(PERSON))?.token).toBeNull();
    expect(audited(world)).toStrictEqual([
      ["bot:bot-1", "refused.person.token", null, "human_only"],
    ]);
  });
});

describe("issuePersonToken: a re-sent form never rotates again (GROKCHAT-18)", () => {
  it("issues only while the token is the one the form was shown with", async () => {
    const world = makeWorld();
    await world.people.save(aPerson());
    const presenter = new Capture<IssuePersonTokenOutputData>();
    const issue = new IssuePersonTokenInteractor(ports(world), presenter);
    const form = { actor: HUMAN, personId: PERSON, expected: { createdAt: null } };
    await issue.execute(form);
    expect(presenter.last.ok).toBe(true);
    const issued = await world.people.get(PERSON);
    world.clock.advance(5000);
    await issue.execute(form);
    expect(presenter.last).toStrictEqual({
      ok: false,
      code: "token_already_issued",
      person: issued,
    });
    expect(await world.people.get(PERSON)).toStrictEqual(issued);
    await issue.execute({ ...form, expected: { createdAt: T0 + 1 } });
    expect(presenter.last).toMatchObject({ ok: false, code: "token_already_issued" });
    await issue.execute({ ...form, expected: null });
    expect(presenter.last).toMatchObject({ ok: false, code: "token_already_issued" });
    expect(await world.people.get(PERSON)).toStrictEqual(issued);
    await issue.execute({ ...form, expected: { createdAt: T0 } });
    expect(presenter.last).toMatchObject({ ok: true, rotated: true });
    expect(audited(world).map((row) => row[1])).toStrictEqual([
      "person.token",
      "refused.person.token",
      "refused.person.token",
      "refused.person.token",
      "person.token",
    ]);
    expect(audited(world)[1]?.[3]).toBe("token_already_issued");
  });

  it("of two forms sent at once for the same token, exactly one rotates; the other is shown the winner", async () => {
    const world = makeWorld();
    await world.people.save(aPerson({ token: { sha256: "a".repeat(64), createdAt: T0 } }));
    const presenter = new Capture<IssuePersonTokenOutputData>();
    const issue = new IssuePersonTokenInteractor(ports(world), presenter);
    const form = { actor: HUMAN, personId: PERSON, expected: { createdAt: T0 } };
    await Promise.all([issue.execute(form), issue.execute(form)]);
    const [won, lost] = presenter.outputs;
    const stored = await world.people.get(PERSON);
    expect(won).toMatchObject({ ok: true, rotated: true, person: stored });
    expect(lost).toStrictEqual({ ok: false, code: "token_already_issued", person: stored });
    expect(audited(world).map((row) => row[1])).toStrictEqual([
      "person.token",
      "refused.person.token",
    ]);
  });

  it("a rotation in the same millisecond still gets a later creation time, so the old form is spent", async () => {
    const world = makeWorld();
    await world.people.save(aPerson());
    const presenter = new Capture<IssuePersonTokenOutputData>();
    const issue = new IssuePersonTokenInteractor(ports(world), presenter);
    await issue.execute({ actor: HUMAN, personId: PERSON, expected: { createdAt: null } });
    await issue.execute({ actor: HUMAN, personId: PERSON, expected: { createdAt: T0 } });
    expect((await world.people.get(PERSON))?.token?.createdAt).toBe(T0 + 1);
    await issue.execute({ actor: HUMAN, personId: PERSON, expected: { createdAt: T0 } });
    expect(presenter.last).toMatchObject({ ok: false, code: "token_already_issued" });
    expect((await world.people.get(PERSON))?.token?.createdAt).toBe(T0 + 1);
  });

  it("a person deleted between the read and the write is not given a token", async () => {
    const world = makeWorld();
    await world.people.save(aPerson());
    const presenter = new Capture<IssuePersonTokenOutputData>();
    const person = await world.people.get(PERSON);
    vi.spyOn(world.people, "replaceToken").mockImplementation(async () => {
      await world.people.delete(PERSON);
      return false;
    });
    const issue = new IssuePersonTokenInteractor(ports(world), presenter);
    await issue.execute({ actor: HUMAN, personId: PERSON, expected: { createdAt: null } });
    expect(presenter.last).toStrictEqual({ ok: false, code: "token_already_issued", person });
  });

  it("a person with no token and no expectation sent is not issued one", async () => {
    const world = makeWorld();
    await world.people.save(aPerson());
    const presenter = new Capture<IssuePersonTokenOutputData>();
    await new IssuePersonTokenInteractor(ports(world), presenter).execute({
      actor: HUMAN,
      personId: PERSON,
      expected: null,
    });
    expect(presenter.last).toMatchObject({ ok: false, code: "token_already_issued" });
    expect((await world.people.get(PERSON))?.token).toBeNull();
  });
});

describe("listPeople", () => {
  it("lists people by name with their accounts by id; bots are refused", async () => {
    const world = makeWorld();
    await withTwoAccounts(world);
    const karl = aPerson();
    const aaron = aPerson({ id: personId("p-2"), name: "Aaron" });
    await world.people.save(karl);
    await world.people.save(aaron);
    await world.owners.assign(OTHER_ACCOUNT, PERSON);
    await world.owners.assign(ACCOUNT, PERSON);
    const presenter = new Capture<ListPeopleOutputData>();
    const list = new ListPeopleInteractor(world, presenter);
    await list.execute({ actor: HUMAN });
    expect(presenter.last).toStrictEqual({
      ok: true,
      people: [
        { person: aaron, accountIds: [] },
        { person: karl, accountIds: [ACCOUNT, OTHER_ACCOUNT] },
      ],
    });
    await list.execute({ actor: botActor() });
    expect(presenter.last).toStrictEqual(HUMAN_ONLY);
    expect(audited(world)).toStrictEqual([
      ["bot:bot-1", "refused.person.list", null, "human_only"],
    ]);
  });
});

describe("listOwnAccounts", () => {
  it("a bot sees exactly its scope, by id; a human sees every account", async () => {
    const world = makeWorld();
    await withTwoAccounts(world);
    await world.accounts.save(anAccount({ id: accountId("acc-0"), xUserId: xUserId("x-0") }));
    const presenter = new Capture<ListOwnAccountsOutputData>();
    const list = new ListOwnAccountsInteractor(world.accounts, presenter);
    await list.execute({ actor: botActor([OTHER_ACCOUNT, ACCOUNT, accountId("ghost")]) });
    expect(presenter.last.accounts.map((account) => account.id)).toStrictEqual([
      ACCOUNT,
      OTHER_ACCOUNT,
    ]);
    await list.execute({ actor: botActor([]) });
    expect(presenter.last).toStrictEqual({ ok: true, accounts: [] });
    await list.execute({ actor: HUMAN });
    expect(presenter.last.accounts).toHaveLength(3);
    expect(world.audit.events).toStrictEqual([]);
  });
});
