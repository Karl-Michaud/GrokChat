/** Every refusal is audited under the use case's own action name (I2, rev 4 B1). */
import { describe, expect, it } from "vitest";
import { DAY } from "../../../src/entities/time/instant";
import type { AccountCommandResult } from "../../../src/use_cases/admin/account_command";
import { ConfirmDisclosureInteractor } from "../../../src/use_cases/confirm_disclosure/interactor";
import { ConnectAccountBeginInteractor } from "../../../src/use_cases/connect_account_begin/interactor";
import { CostTotalsInteractor } from "../../../src/use_cases/cost_totals/interactor";
import { GetCalendarInteractor } from "../../../src/use_cases/get_calendar/interactor";
import { SetPolicyInteractor } from "../../../src/use_cases/set_policy/interactor";
import { StageMediaUploadInteractor } from "../../../src/use_cases/stage_media_upload/interactor";
import { ACCOUNT, aPolicy, botActor, HUMAN, T0 } from "../support/builders";
import { Capture, makeWorld, PNG, type World } from "../support/world";

const WINDOW = { from: T0 - DAY, to: T0 + DAY };
const BOT = botActor();

/** Human-only use cases, each run by a bot, with the action its refusal is audited under. */
const HUMAN_ONLY: readonly [string, (world: World) => Promise<void>][] = [
  [
    "calendar.get",
    (w) =>
      new GetCalendarInteractor(w.reader, w.guard, new Capture()).execute({
        actor: BOT,
        window: WINDOW,
      }),
  ],
  [
    "costs.totals",
    (w) =>
      new CostTotalsInteractor(w.costs, w.guard, new Capture()).execute({
        actor: BOT,
        window: WINDOW,
        accountId: null,
      }),
  ],
  [
    "account.connect_begin",
    (w) =>
      new ConnectAccountBeginInteractor(
        {
          states: w.states,
          pkce: w.pkce,
          connector: w.connector,
          guard: w.guard,
          ids: w.ids,
          clock: w.clock,
        },
        new Capture(),
      ).execute({ actor: BOT, sessionId: "s" }),
  ],
  [
    "media.upload",
    (w) =>
      new StageMediaUploadInteractor(w.accounts, w.intake, w.guard, new Capture()).execute({
        actor: BOT,
        accountId: ACCOUNT,
        bytes: PNG,
      }),
  ],
  [
    "account.disclosure",
    (w) =>
      new ConfirmDisclosureInteractor(w.accountCommand, new Capture()).execute({
        actor: BOT,
        accountId: ACCOUNT,
        bioConfirmed: true,
        automatedLabelConfirmed: true,
      }),
  ],
];

describe("human-only refusals are audited under the action's name", () => {
  it.each(HUMAN_ONLY)("%s", async (action, run) => {
    const world = makeWorld();
    await world.seedAccount();
    await run(world);
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      [`refused.${action}`, "human_only"],
    ]);
  });
});

describe("account commands", () => {
  it("present their result and audit success with an empty detail", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const presenter = new Capture<AccountCommandResult>();
    await new ConfirmDisclosureInteractor(world.accountCommand, presenter).execute({
      actor: HUMAN,
      accountId: ACCOUNT,
      bioConfirmed: false,
      automatedLabelConfirmed: true,
    });
    expect(presenter.last).toMatchObject({
      ok: true,
      account: { disclosure: { bioConfirmed: false, automatedLabelConfirmed: true } },
    });
    await new SetPolicyInteractor(world.accountCommand, new Capture()).execute({
      actor: HUMAN,
      accountId: ACCOUNT,
      policy: aPolicy(),
    });
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      ["account.disclosure", ""],
      ["account.policy", ""],
    ]);
  });
});
