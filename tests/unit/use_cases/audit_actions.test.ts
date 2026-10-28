/** Every refusal is audited under the use case's own action name (I2, rev 4 B1). */
import { describe, expect, it } from "vitest";
import { DAY } from "../../../src/entities/time/instant";
import type { AccountCommandResult } from "../../../src/use_cases/admin/account_command";
import { ConfirmDisclosureInteractor } from "../../../src/use_cases/confirm_disclosure/interactor";
import { ConnectAccountBeginInteractor } from "../../../src/use_cases/connect_account_begin/interactor";
import { GetAnalyticsInteractor } from "../../../src/use_cases/get_analytics/interactor";
import { ListActivityInteractor } from "../../../src/use_cases/list_activity/interactor";
import { ListPostsInteractor } from "../../../src/use_cases/list_posts/interactor";
import { SetPolicyInteractor } from "../../../src/use_cases/set_policy/interactor";
import { StageMediaUploadInteractor } from "../../../src/use_cases/stage_media_upload/interactor";
import { ACCOUNT, aPolicy, botActor, HUMAN, T0 } from "../support/builders";
import { Capture, makeWorld, PNG, type World } from "../support/world";

const WINDOW = { from: T0 - DAY, to: T0 + DAY };
const BOT = botActor();

/** Human-only use cases, each run by a bot, with the action its refusal is audited under. */
const HUMAN_ONLY: readonly [string, (world: World) => Promise<void>][] = [
  [
    "analytics.get",
    (w) =>
      new GetAnalyticsInteractor(
        { ...w, followers: w.followers, metrics: w.metrics },
        new Capture(),
      ).execute({ actor: BOT, range: "7d", accountId: null }),
  ],
  [
    "activity.list",
    (w) =>
      new ListActivityInteractor(w.activity, w.guard, new Capture()).execute({
        actor: BOT,
        filter: {},
        page: 1,
        pageSize: 10,
      }),
  ],
  [
    "post.list",
    (w) =>
      new ListPostsInteractor(w, new Capture()).execute({
        actor: BOT,
        accountId: null,
        statuses: null,
        window: WINDOW,
        sort: "time",
        direction: "desc",
        page: 1,
        pageSize: 10,
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
