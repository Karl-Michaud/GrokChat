import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../../src/entities/accounts/posting_policy";
import { accountId, xUserId } from "../../../src/entities/identity/ids";
import { HOUR, MINUTE } from "../../../src/entities/time/instant";
import type { AccountCommandResult } from "../../../src/use_cases/admin/account_command";
import { ConfirmDisclosureInteractor } from "../../../src/use_cases/confirm_disclosure/interactor";
import {
  ConnectAccountBeginInteractor,
  OAUTH_STATE_TTL,
} from "../../../src/use_cases/connect_account_begin/interactor";
import type { ConnectAccountBeginOutputData } from "../../../src/use_cases/connect_account_begin/output_data";
import { ConnectAccountCompleteInteractor } from "../../../src/use_cases/connect_account_complete/interactor";
import type { ConnectAccountCompleteInputData } from "../../../src/use_cases/connect_account_complete/input_data";
import type { ConnectAccountCompleteOutputData } from "../../../src/use_cases/connect_account_complete/output_data";
import { SetAccountStatusInteractor } from "../../../src/use_cases/set_account_status/interactor";
import { SetPolicyInteractor } from "../../../src/use_cases/set_policy/interactor";
import { ACCOUNT, aPolicy, botActor, HUMAN, T0 } from "../support/builders";
import { Capture, makeWorld, type World } from "../support/world";
import { required } from "../support/publishing";

describe("setPolicy, setAccountStatus, confirmDisclosure (AccountCommand)", () => {
  it("setPolicy validates, saves and audits; bots and unknown accounts are refused", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const presenter = new Capture<AccountCommandResult<string>>();
    const set = new SetPolicyInteractor(world.accountCommand, presenter);
    const policy = aPolicy({ dailyCap: 3 });
    await set.execute({ actor: HUMAN, accountId: ACCOUNT, policy });
    expect(presenter.last).toMatchObject({ ok: true, account: { policy } });
    expect((await world.accounts.get(ACCOUNT))?.policy).toStrictEqual(policy);
    await set.execute({ actor: HUMAN, accountId: ACCOUNT, policy: aPolicy({ dailyCap: 0 }) });
    expect(presenter.last).toStrictEqual({ ok: false, code: "daily_cap" });
    await set.execute({ actor: botActor(), accountId: ACCOUNT, policy });
    expect(presenter.last).toStrictEqual({ ok: false, code: "human_only" });
    await set.execute({ actor: HUMAN, accountId: accountId("zz"), policy });
    expect(presenter.last).toStrictEqual({ ok: false, code: "not_found" });
    expect(world.audit.events.map((event) => event.action)).toStrictEqual([
      "account.policy",
      "refused.account.policy",
    ]);
  });

  it("the kill switch toggles ACTIVE and PAUSED only; a reconnect is needed otherwise", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const presenter = new Capture<AccountCommandResult<string>>();
    const set = new SetAccountStatusInteractor(world.accountCommand, presenter);
    await set.execute({ actor: HUMAN, accountId: ACCOUNT, status: "PAUSED" });
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("PAUSED");
    await set.execute({ actor: HUMAN, accountId: ACCOUNT, status: "ACTIVE" });
    expect((await world.accounts.get(ACCOUNT))?.status).toBe("ACTIVE");
    for (const status of ["NEEDS_RECONNECT", "DISCONNECTED"] as const) {
      await world.accounts.save({ ...required(await world.accounts.get(ACCOUNT)), status });
      await set.execute({ actor: HUMAN, accountId: ACCOUNT, status: "ACTIVE" });
      expect(presenter.last).toStrictEqual({ ok: false, code: "needs_reconnect" });
      expect((await world.accounts.get(ACCOUNT))?.status).toBe(status);
    }
    expect(world.audit.events.map((event) => event.action)).toStrictEqual([
      "account.paused",
      "account.active",
    ]);
  });

  it("confirmDisclosure records both confirmations", async () => {
    const world = makeWorld();
    await world.seedAccount({
      disclosure: { bioConfirmed: false, automatedLabelConfirmed: false },
    });
    const presenter = new Capture<AccountCommandResult>();
    await new ConfirmDisclosureInteractor(world.accountCommand, presenter).execute({
      actor: HUMAN,
      accountId: ACCOUNT,
      bioConfirmed: true,
      automatedLabelConfirmed: false,
    });
    expect((await world.accounts.get(ACCOUNT))?.disclosure).toStrictEqual({
      bioConfirmed: true,
      automatedLabelConfirmed: false,
    });
  });
});

describe("connecting an X account (rev 4 M7, R11)", () => {
  const user = (id = "x-user-1", handle = "muse") => ({
    xUserId: xUserId(id),
    handle,
    tokens: { accessToken: "a-new", refreshToken: "r-new", accessExpiresAt: T0 + 2 * HOUR },
  });

  async function begin(world: World, actor = HUMAN): Promise<ConnectAccountBeginOutputData> {
    const presenter = new Capture<ConnectAccountBeginOutputData>();
    const interactor = new ConnectAccountBeginInteractor(
      {
        states: world.states,
        pkce: world.pkce,
        connector: world.connector,
        guard: world.guard,
        ids: world.ids,
        clock: world.clock,
      },
      presenter,
    );
    await interactor.execute({ actor, sessionId: "session-1" });
    return presenter.last;
  }

  async function complete(world: World, input: Partial<ConnectAccountCompleteInputData>) {
    const presenter = new Capture<ConnectAccountCompleteOutputData>();
    const interactor = new ConnectAccountCompleteInteractor(
      {
        states: world.states,
        connector: world.connector,
        accounts: world.accounts,
        gateway: world.gateway,
        guard: world.guard,
        audit: world.actionAudit,
        ids: world.ids,
        clock: world.clock,
      },
      presenter,
    );
    await interactor.execute({
      actor: HUMAN,
      sessionId: "session-1",
      state: "id-1",
      code: "code-1",
      reconnect: null,
      ...input,
    });
    return presenter.last;
  }

  it("begin stores a single-use state bound to the session, with a PKCE verifier", async () => {
    const world = makeWorld();
    expect(await begin(world)).toStrictEqual({
      ok: true,
      authorizeUrl: "https://x.com/i/oauth2/authorize?state=id-1&code_challenge=challenge-1",
    });
    expect(OAUTH_STATE_TTL).toBe(10 * MINUTE);
    expect(world.states.records.get("id-1")).toStrictEqual({
      state: "id-1",
      verifier: "verifier-1",
      sessionId: "session-1",
      expiresAt: T0 + 10 * MINUTE,
    });
    expect(await begin(world, botActor())).toStrictEqual({ ok: false, code: "human_only" });
  });

  it("a new account needs no personality, starts PAUSED and undisclosed; its tokens go to the DO, never the output", async () => {
    const world = makeWorld();
    await begin(world);
    world.connector.codes.set("code-1", { verifier: "verifier-1", user: user() });
    const out = await complete(world, {});
    expect(out).toStrictEqual({
      ok: true,
      accountId: accountId("id-2"),
      handle: "muse",
      status: "PAUSED",
    });
    expect(await world.accounts.get(accountId("id-2"))).toStrictEqual({
      id: accountId("id-2"),
      xUserId: xUserId("x-user-1"),
      handle: "muse",
      status: "PAUSED",
      disclosure: { bioConfirmed: false, automatedLabelConfirmed: false },
      policy: DEFAULT_POLICY,
      isAppOwner: false,
    });
    expect((await world.tokenStore.load(accountId("id-2")))?.tokens).toStrictEqual(user().tokens);
    expect(JSON.stringify(world.audit.events)).not.toContain("a-new");
    expect(
      world.audit.events.map((event) => [event.action, event.accountId, event.detail]),
    ).toStrictEqual([["account.connect", accountId("id-2"), "@muse"]]);
  });

  it("refuses a replayed, foreign-session or expired state, and a failed exchange", async () => {
    const world = makeWorld();
    await begin(world);
    expect(await complete(world, { sessionId: "other" })).toStrictEqual({
      ok: false,
      code: "oauth_state",
    });
    expect(await complete(world, {})).toStrictEqual({ ok: false, code: "oauth_state" });
    await begin(world);
    world.clock.advance(10 * MINUTE);
    expect(await complete(world, { state: "id-2" })).toStrictEqual({
      ok: false,
      code: "oauth_state",
    });
    world.clock.set(T0);
    await begin(world);
    expect(await complete(world, { state: "id-3" })).toStrictEqual({
      ok: false,
      code: "oauth_failed",
    });
    expect(await complete(world, { actor: botActor() })).toStrictEqual({
      ok: false,
      code: "human_only",
    });
  });

  it("a reconnect must be the same X user and clears NEEDS_RECONNECT to PAUSED", async () => {
    const world = makeWorld();
    await world.seedAccount({ status: "NEEDS_RECONNECT" });
    await world.tokenStore.markRefreshing(ACCOUNT, T0);
    await begin(world);
    world.connector.codes.set("code-1", {
      verifier: "verifier-1",
      user: user("x-user-1", "renamed"),
    });
    expect(await complete(world, { reconnect: ACCOUNT })).toStrictEqual({
      ok: true,
      accountId: ACCOUNT,
      handle: "renamed",
      status: "PAUSED",
    });
    expect(await world.tokenStore.load(ACCOUNT)).toStrictEqual({
      tokens: user().tokens,
      refreshingSince: null,
    });

    await begin(world);
    world.connector.codes.set("code-1", { verifier: "verifier-2", user: user("x-user-9") });
    expect(await complete(world, { reconnect: ACCOUNT, state: "id-2" })).toStrictEqual({
      ok: false,
      code: "different_x_user",
    });
  });

  it("an ACTIVE account reconnecting stays ACTIVE", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await begin(world);
    world.connector.codes.set("code-1", { verifier: "verifier-1", user: user() });
    expect(await complete(world, { reconnect: ACCOUNT })).toMatchObject({
      ok: true,
      status: "ACTIVE",
    });
  });

  it("refuses an unknown reconnect target and an X user already connected", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const attempt = async (input: Partial<ConnectAccountCompleteInputData>, who = user()) => {
      await begin(world);
      const state = [...world.states.records.keys()].at(-1) ?? "";
      const verifier = world.states.records.get(state)?.verifier ?? "";
      world.connector.codes.set("code-1", { verifier, user: who });
      return complete(world, { state, ...input });
    };
    expect(await attempt({ reconnect: accountId("zz") })).toStrictEqual({
      ok: false,
      code: "not_found",
    });
    expect(await attempt({})).toStrictEqual({ ok: false, code: "already_connected" });
  });
});
