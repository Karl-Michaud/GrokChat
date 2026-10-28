import { describe, expect, it } from "vitest";
import { postId } from "../../../../src/entities/identity/ids";
import {
  ActivityController,
  ACTIVITY_PAGE_SIZE,
} from "../../../../src/interface_adapters/dashboard/activity_controller";
import { ACCOUNT, OTHER_ACCOUNT, T0 } from "../../support/builders";
import { dashboardUseCases, presenting } from "../../support/dashboard";
import { makeWorld } from "../../support/world";

const query = (overrides = {}) => ({
  account: null,
  actor: null,
  kind: null,
  page: null,
  ...overrides,
});

async function seeded(extra = 0) {
  const world = makeWorld();
  await world.seedAccount();
  const append = (at: number, actor: string, action: string, account = ACCOUNT) =>
    world.audit.append({ at, actor, action, accountId: account, postId: postId("p1"), detail: "" });
  await append(T0 - 3, "bot:muse", "post.create");
  await append(T0 - 2, "system:x", "x.create");
  await world.costs.append({
    at: T0 - 2,
    accountId: ACCOUNT,
    operation: "create",
    estimate: { kind: "usd", micros: 15_000 },
  });
  await append(T0 - 1, "human:admin", "refused.post.edit", OTHER_ACCOUNT);
  for (let n = 0; n < extra; n += 1) {
    await append(T0 - 100 - n, "system:x", "x.read");
  }
  return { world, controller: new ActivityController(dashboardUseCases(world), world.clock) };
}

describe("the activity page (GROKCHAT-15)", () => {
  it("every request newest first: who, what, account, post and cost", async () => {
    const { controller } = await seeded();
    const outcome = await controller.activity(query());
    if (outcome.kind !== "page") {
      throw new Error(outcome.kind);
    }
    const { view } = outcome;
    expect(view.rows.map((row) => [row.actor.kind, row.action.label, row.cost])).toStrictEqual([
      ["human", "Refused: Edited a post", ""],
      ["system", "Published on X", "$0.015"],
      ["bot", "Created a post", ""],
    ]);
    expect([
      view.total,
      view.page,
      view.pages,
      view.previous,
      view.next,
      view.filtered,
    ]).toStrictEqual(["3", 1, 1, null, null, false]);
    expect(
      view.actors.map((choice) => [choice.value, choice.label, choice.selected]),
    ).toStrictEqual([
      ["bot", "Bots", false],
      ["human", "You", false],
      ["system", "System", false],
    ]);
    expect(view.kinds.map((choice) => choice.label)).toStrictEqual([
      "Posts",
      "Publishing",
      "Metrics reads",
      "Accounts",
      "Refusals",
      "Media",
      "Logins",
    ]);
  });

  it("filters by account, actor and kind", async () => {
    const { controller } = await seeded();
    const labels = async (overrides: object) => {
      const outcome = await controller.activity(query(overrides));
      return outcome.kind === "page" ? outcome.view.rows.map((row) => row.action.label) : [];
    };
    expect(await labels({ account: "acc-2" })).toStrictEqual(["Refused: Edited a post"]);
    expect(await labels({ actor: "bot" })).toStrictEqual(["Created a post"]);
    expect(await labels({ kind: "publishing" })).toStrictEqual(["Published on X"]);
    const outcome = await controller.activity(
      query({ actor: "system", kind: "publishing", account: "acc-1" }),
    );
    expect(outcome).toMatchObject({ view: { filtered: true } });
    if (outcome.kind === "page") {
      expect(outcome.view.actors.find((choice) => choice.selected)?.value).toBe("system");
      expect(outcome.view.kinds.find((choice) => choice.selected)?.value).toBe("publishing");
    }
    expect(await controller.activity(query({ kind: "reads" }))).toMatchObject({
      view: { filtered: true, rows: [] },
    });
    expect(await controller.activity(query({ account: "acc-1" }))).toMatchObject({
      view: { filtered: true },
    });
    expect(await controller.activity(query({ actor: "human" }))).toMatchObject({
      view: { filtered: true },
    });
  });

  it("pages of 50 with links that keep the filters", async () => {
    const { controller } = await seeded(ACTIVITY_PAGE_SIZE);
    const first = await controller.activity(query({ actor: "system" }));
    expect(first).toMatchObject({
      view: { pages: 2, previous: null, next: "/dashboard/activity?actor=system&page=2" },
    });
    const second = await controller.activity(query({ actor: "system", page: "2" }));
    expect(second).toMatchObject({
      view: { page: 2, previous: "/dashboard/activity?actor=system&page=1", next: null },
    });
  });

  it("refuses unknown filters and shows the use case's refusal", async () => {
    const { controller, world } = await seeded();
    const refused = { kind: "refused", status: 400, message: "Unknown filter or page." };
    expect(await controller.activity(query({ actor: "robot" }))).toStrictEqual(refused);
    expect(await controller.activity(query({ kind: "all" }))).toStrictEqual(refused);
    expect(await controller.activity(query({ page: "-1" }))).toStrictEqual(refused);
    const refusing = new ActivityController(
      { ...dashboardUseCases(world), activity: presenting({ ok: false, code: "human_only" }) },
      world.clock,
    );
    expect(await refusing.activity(query())).toMatchObject({ kind: "refused", status: 403 });
  });
});
