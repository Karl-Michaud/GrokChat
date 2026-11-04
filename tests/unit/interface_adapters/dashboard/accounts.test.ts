import { describe, expect, it } from "vitest";
import { accountId, xUserId } from "../../../../src/entities/identity/ids";
import { HOUR, MINUTE } from "../../../../src/entities/time/instant";
import {
  AccountsController,
  limitsOf,
} from "../../../../src/interface_adapters/dashboard/accounts_controller";
import { OAuthController } from "../../../../src/interface_adapters/dashboard/oauth_controller";
import {
  parsePolicyForm,
  policyForm,
  type PolicyForm,
} from "../../../../src/interface_adapters/dashboard/policy_form";
import {
  ACCOUNT,
  aFollowerSnapshot,
  aPolicy,
  anAccount,
  aPost,
  part,
  sentState,
  T0,
} from "../../support/builders";
import { dashboardUseCases, presenting } from "../../support/dashboard";
import { makeWorld, type World } from "../../support/world";

async function setup() {
  const world = makeWorld();
  await world.seedAccount();
  await world.accounts.save(
    anAccount({
      id: accountId("acc-2"),
      xUserId: xUserId("x-user-2"),
      handle: "two",
      status: "NEEDS_RECONNECT",
      disclosure: { bioConfirmed: false, automatedLabelConfirmed: true },
      policy: aPolicy({
        mode: "REVIEW",
        quietHours: { startMinute: 22 * 60, endMinute: 6 * 60 + 30 },
        linkPolicy: "REFUSE",
      }),
    }),
  );
  const useCases = dashboardUseCases(world);
  return { world, useCases, controller: new AccountsController(useCases) };
}

const FORM: PolicyForm = {
  mode: "AUTO",
  dailyCap: "10",
  minGapMinutes: "30",
  quietStart: "",
  quietEnd: "",
  tz: "UTC",
  linkPolicy: "ALLOW",
  graceMinutes: "30",
};

const ORIGIN = "https://grokchat.test";

const REDIRECT = { kind: "redirect", location: "/dashboard/accounts" };

const UNASSIGNED = { value: "", label: "Unassigned", selected: true };

describe("the accounts page", () => {
  it("a card per account: status, mode, limits, disclosure, numbers, policy; and the bot setup", async () => {
    const { controller, world } = await setup();
    await world.writer.add(
      aPost({ lifecycle: "DONE", parts: [part("p", sentState("x-1", T0 - HOUR))] }),
    );
    const snapshot = aFollowerSnapshot(T0 - HOUR, 1_234);
    await world.followers.claim(ACCOUNT, snapshot.day, T0 - HOUR);
    await world.followers.record(snapshot);
    expect(await controller.accounts({ connected: null, origin: ORIGIN })).toStrictEqual({
      kind: "page",
      view: {
        people: [],
        total: 2,
        unassigned: [
          {
            id: "acc-1",
            badge: { id: "acc-1", handle: "@musechat_one", initials: "MO", tone: 1 },
            status: { label: "Active", tone: "good" },
            needsReconnect: false,
            canActivate: false,
            canPause: true,
            mode: "Auto-publish",
            limits: ["10 posts a day", "30 min apart", "No quiet hours", "UTC", "Links allowed"],
            bioConfirmed: true,
            automatedLabelConfirmed: true,
            disclosed: true,
            followers: "1.2K",
            posts7d: "1",
            policy: FORM,
            owners: [UNASSIGNED],
          },
          {
            id: "acc-2",
            badge: { id: "acc-2", handle: "@two", initials: "TW", tone: 2 },
            status: { label: "Reconnect needed", tone: "critical" },
            needsReconnect: true,
            canActivate: false,
            canPause: false,
            mode: "Review first",
            limits: [
              "10 posts a day",
              "30 min apart",
              "Quiet 22:00–06:30",
              "UTC",
              "No https:// links",
            ],
            bioConfirmed: false,
            automatedLabelConfirmed: true,
            disclosed: false,
            followers: "—",
            posts7d: "0",
            policy: {
              ...FORM,
              mode: "REVIEW",
              quietStart: "22:00",
              quietEnd: "06:30",
              linkPolicy: "REFUSE",
            },
            owners: [UNASSIGNED],
          },
        ],
        notice: null,
        mcpUrl: "https://grokchat.test/mcp",
      },
    });
  });

  it("states the limits in words", () => {
    expect(limitsOf(aPolicy({ dailyCap: 1, minGap: 0, tz: "Europe/Paris" }))).toStrictEqual([
      "1 post a day",
      "No minimum gap",
      "No quiet hours",
      "Europe/Paris",
      "Links allowed",
    ]);
    expect(limitsOf(aPolicy({ minGap: 90 * MINUTE }))[1]).toBe("90 min apart");
  });

  it("marks a disconnected account for reconnecting, a paused one for activating", async () => {
    const { controller, world } = await setup();
    await world.accounts.save(anAccount({ status: "PAUSED" }));
    await world.accounts.save(anAccount({ id: accountId("acc-2"), status: "DISCONNECTED" }));
    const outcome = await controller.accounts({ connected: "@new", origin: ORIGIN });
    expect(outcome).toMatchObject({
      view: {
        unassigned: [
          { needsReconnect: false, canActivate: true, canPause: false },
          { needsReconnect: true, canActivate: false, canPause: false },
        ],
        notice: "Connected @new. It starts paused.",
      },
    });
    expect(await controller.accounts({ connected: " ", origin: ORIGIN })).toMatchObject({
      view: { notice: null },
    });
  });

  it("without the week's analytics, a card shows no followers and no posts", async () => {
    const { useCases } = await setup();
    const refusing = new AccountsController({
      ...useCases,
      analytics: presenting({ ok: false, code: "human_only" }),
    });
    expect(await refusing.accounts({ connected: null, origin: ORIGIN })).toMatchObject({
      view: {
        unassigned: [
          { followers: "—", posts7d: "0" },
          { followers: "—", posts7d: "0" },
        ],
      },
    });
  });

  it("lists nothing when the use cases refuse", async () => {
    const { useCases } = await setup();
    const refusing = new AccountsController({
      ...useCases,
      listAccounts: presenting({ ok: false, code: "human_only" }),
      listPeople: presenting({ ok: false, code: "human_only" }),
    });
    expect(await refusing.accounts({ connected: null, origin: ORIGIN })).toStrictEqual({
      kind: "page",
      view: {
        people: [],
        unassigned: [],
        total: 0,
        notice: null,
        mcpUrl: "https://grokchat.test/mcp",
      },
    });
  });

  it("the kill switch pauses and activates; other statuses are refused", async () => {
    const { controller, world } = await setup();
    expect(await controller.status("acc-1", "PAUSED")).toStrictEqual(REDIRECT);
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("PAUSED");
    expect(await controller.status("acc-1", "ACTIVE")).toStrictEqual(REDIRECT);
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("ACTIVE");
    expect(await controller.status("acc-1", "DISCONNECTED")).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "The status must be ACTIVE or PAUSED.",
    });
    expect(await controller.status("acc-2", "ACTIVE")).toStrictEqual({
      kind: "refused",
      status: 409,
      message: "Reconnect the account on X first.",
    });
  });

  it("confirms the disclosure", async () => {
    const { controller, world } = await setup();
    const form = { bioConfirmed: true, automatedLabelConfirmed: false };
    expect(await controller.disclosure("acc-2", form)).toStrictEqual(REDIRECT);
    expect((await world.accounts.get(accountId("acc-2")))?.disclosure).toStrictEqual(form);
    expect(await controller.disclosure("nope", form)).toMatchObject({ status: 404 });
  });

  it("saves a policy; the use case refuses out-of-range values", async () => {
    const { controller, world } = await setup();
    const form = { ...FORM, dailyCap: "3", quietStart: "23:00", quietEnd: "07:00" };
    expect(await controller.policy("acc-1", form)).toStrictEqual(REDIRECT);
    expect((await world.accounts.get(ACCOUNT))?.policy).toStrictEqual(
      aPolicy({ dailyCap: 3, quietHours: { startMinute: 23 * 60, endMinute: 7 * 60 } }),
    );
    expect(await controller.policy("acc-1", { ...FORM, dailyCap: "0" })).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "The daily cap must be a whole number of at least 1.",
    });
    expect(await controller.policy("acc-1", { ...FORM, mode: "FAST" })).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "Choose a mode and a link policy.",
    });
  });
});

describe("the policy form", () => {
  it("shows a policy as fields and reads it back", () => {
    const policy = aPolicy({
      mode: "REVIEW",
      dailyCap: 4,
      minGap: 45 * MINUTE,
      quietHours: { startMinute: 0, endMinute: 6 * 60 },
      tz: "Europe/Paris",
      linkPolicy: "REFUSE",
      grace: 0,
    });
    const form = policyForm(policy);
    expect(form).toStrictEqual({
      mode: "REVIEW",
      dailyCap: "4",
      minGapMinutes: "45",
      quietStart: "00:00",
      quietEnd: "06:00",
      tz: "Europe/Paris",
      linkPolicy: "REFUSE",
      graceMinutes: "0",
    });
    expect(parsePolicyForm(form)).toStrictEqual(policy);
    expect(parsePolicyForm({ ...form, tz: " UTC " })).toMatchObject({ tz: "UTC" });
  });

  it("names the first field of the wrong shape", () => {
    const modes = { message: "Choose a mode and a link policy." };
    const numbers = { message: "The cap, the gap and the grace must be whole numbers." };
    const quiet = { message: "Quiet hours must be two HH:MM times, or both empty." };
    expect(parsePolicyForm({ ...FORM, mode: "auto" })).toStrictEqual(modes);
    expect(parsePolicyForm({ ...FORM, linkPolicy: "" })).toStrictEqual(modes);
    expect(parsePolicyForm({ ...FORM, dailyCap: "x" })).toStrictEqual(numbers);
    expect(parsePolicyForm({ ...FORM, minGapMinutes: "1.5" })).toStrictEqual(numbers);
    expect(parsePolicyForm({ ...FORM, graceMinutes: "-1" })).toStrictEqual(numbers);
    expect(parsePolicyForm({ ...FORM, quietStart: "22:00" })).toStrictEqual(quiet);
    expect(parsePolicyForm({ ...FORM, quietEnd: "06:00" })).toStrictEqual(quiet);
    expect(parsePolicyForm({ ...FORM, quietStart: "25:00", quietEnd: "06:00" })).toStrictEqual(
      quiet,
    );
    expect(parsePolicyForm({ ...FORM, quietStart: "22:00", quietEnd: "6am" })).toStrictEqual(quiet);
    expect(parsePolicyForm({ ...FORM, quietStart: " ", quietEnd: " " })).toMatchObject({
      quietHours: null,
    });
  });
});

describe("the OAuth connect flow (R11)", () => {
  const user = (id = "x-user-9", handle = "newbie") => ({
    xUserId: xUserId(id),
    handle,
    tokens: { accessToken: "a", refreshToken: "r", accessExpiresAt: 0 },
  });

  async function begun(world: World, sessionId = "s-1") {
    const controller = new OAuthController(dashboardUseCases(world));
    const outcome = await controller.begin(sessionId);
    const state =
      outcome.kind === "redirect" ? new URL(outcome.location).searchParams.get("state") : null;
    return { controller, outcome, state: state ?? "" };
  }

  const callback = (state: string, overrides = {}) => ({
    sessionId: "s-1",
    code: "code-1",
    state,
    error: null,
    intent: { reconnect: null },
    ...overrides,
  });

  it("begins with a redirect to X carrying a fresh state bound to the session", async () => {
    const { world } = await setup();
    const { outcome, state } = await begun(world);
    expect(outcome).toStrictEqual({
      kind: "redirect",
      location: "https://x.com/i/oauth2/authorize?state=id-1&code_challenge=challenge-1",
    });
    expect(world.states.records.get(state)).toMatchObject({ sessionId: "s-1" });
  });

  it("connects a new account, once: a replayed state is refused", async () => {
    const { world } = await setup();
    const { controller, state } = await begun(world);
    world.connector.codes.set("code-1", { verifier: "verifier-1", user: user() });
    expect(await controller.complete(callback(state))).toStrictEqual({
      kind: "redirect",
      location: "/dashboard/accounts?connected=%40newbie",
    });
    expect((await world.accounts.findByXUserId(xUserId("x-user-9")))?.status).toBe("PAUSED");
    world.connector.codes.set("code-1", { verifier: "verifier-1", user: user() });
    expect(await controller.complete(callback(state))).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "The connect link expired, was already used, or belongs to another session.",
    });
  });

  it("refuses another session's state and an expired one", async () => {
    const { world } = await setup();
    const first = await begun(world);
    world.connector.codes.set("code-1", { verifier: "verifier-1", user: user() });
    expect(
      await first.controller.complete(callback(first.state, { sessionId: "s-2" })),
    ).toMatchObject({ status: 400 });
    const second = await begun(world);
    world.clock.advance(11 * MINUTE);
    world.connector.codes.set("code-1", { verifier: "verifier-2", user: user() });
    expect(await second.controller.complete(callback(second.state))).toMatchObject({
      status: 400,
      message: "The connect link expired, was already used, or belongs to another session.",
    });
    expect(await world.accounts.findByXUserId(xUserId("x-user-9"))).toBeNull();
  });

  it("a reconnect must be the same X user", async () => {
    const { world } = await setup();
    const { controller, state } = await begun(world);
    world.connector.codes.set("code-1", { verifier: "verifier-1", user: user("x-user-7") });
    const reconnect = { reconnect: "acc-2" };
    expect(await controller.complete(callback(state, { intent: reconnect }))).toStrictEqual({
      kind: "refused",
      status: 409,
      message: "That X login is a different account from the one being reconnected.",
    });
    const again = await begun(world);
    world.connector.codes.set("code-1", { verifier: "verifier-2", user: user("x-user-2", "two") });
    expect(
      await again.controller.complete(callback(again.state, { intent: { reconnect: " acc-2 " } })),
    ).toStrictEqual({ kind: "redirect", location: "/dashboard/accounts?connected=%40two" });
    expect((await world.accounts.get(accountId("acc-2")))?.status).toBe("PAUSED");
  });

  it("refuses an error from X and a missing code or state; a new account needs no personality", async () => {
    const { world } = await setup();
    const { controller, state } = await begun(world);
    expect(await controller.complete(callback(state, { error: "access_denied" }))).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "The connection was cancelled or refused on X.",
    });
    const missing = {
      kind: "refused",
      status: 400,
      message: "The callback is missing its code or its state.",
    };
    expect(await controller.complete(callback(state, { code: null }))).toStrictEqual(missing);
    expect(await controller.complete(callback(" "))).toStrictEqual(missing);
    expect(world.states.records.has(state)).toBe(true);
    world.connector.codes.set("code-1", { verifier: "verifier-1", user: user() });
    const none = { reconnect: null };
    expect(await controller.complete(callback(state, { intent: none }))).toStrictEqual({
      kind: "redirect",
      location: "/dashboard/accounts?connected=%40newbie",
    });
  });

  it("shows a refusal to begin", async () => {
    const { useCases } = await setup();
    const refusing = new OAuthController({
      ...useCases,
      connectBegin: presenting({ ok: false, code: "human_only" }),
    });
    expect(await refusing.begin("s-1")).toMatchObject({ kind: "refused", status: 403 });
  });
});
