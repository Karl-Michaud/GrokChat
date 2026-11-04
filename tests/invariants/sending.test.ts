/**
 * I1 each part is sent at most once (R1, R4), I3 no send for an account that may not publish,
 * I4 an UNKNOWN outcome is never re-sent without a human's confirmation, I7 SENDING is persisted
 * before every create. On the in-memory stubs, with the same promise-chain mutex as the DO.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AccountStatus } from "../../src/entities/accounts/account";
import { invocationBudget } from "../../src/entities/budget/budget";
import { postId } from "../../src/entities/identity/ids";
import { HOUR, MINUTE } from "../../src/entities/time/instant";
import type { XScript } from "../../src/frameworks/memory/fake_x";
import { InvocationBudgetMeter } from "../../src/frameworks/budget/invocation_meter";
import type { CommandResult } from "../../src/use_cases/authoring/post_command";
import { ReschedulePostInteractor } from "../../src/use_cases/reschedule_post/interactor";
import { ACCOUNT, aPolicy, aPost, HUMAN, part, T0 } from "../unit/support/builders";
import { Capture, makeWorld, type World } from "../unit/support/world";

const meter = (deadline = T0 + HOUR): InvocationBudgetMeter =>
  new InvocationBudgetMeter(invocationBudget(deadline));

function textsOnX(world: World): readonly string[] {
  return [...world.x.posts.values()].map((post) => post.text);
}

function seedPosts(world: World, count: number, parts = 1): void {
  for (let index = 0; index < count; index += 1) {
    const texts = Array.from({ length: parts }, (_, k) =>
      part(`post ${String(index)} part ${String(k)}`),
    );
    world.table.rows.set(
      postId(`p-${String(index)}`),
      aPost({ id: postId(`p-${String(index)}`), parts: texts }),
    );
  }
}

describe("I1 / R1: concurrent publish calls for one account respect the cap", () => {
  async function race(locks: "mutex" | "none"): Promise<number> {
    const world = makeWorld({ locks });
    await world.seedAccount({ policy: aPolicy({ dailyCap: 3, minGap: 0 }) });
    seedPosts(world, 10);
    world.x.beforeCreate = () => new Promise((resolve) => setTimeout(resolve, 1));
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        world.publishPost.publishNow(ACCOUNT, postId(`p-${String(index)}`), meter()),
      ),
    );
    return world.x.posts.size;
  }

  it("with the publish lock: exactly 3 sends", async () => {
    expect(await race("mutex")).toBe(3);
  });

  it("negative control without the lock: more than 3 (the test can fail)", async () => {
    expect(await race("none")).toBeGreaterThan(3);
  });
});

const scripts: fc.Arbitrary<XScript> = fc.oneof(
  fc.constant<XScript>({ kind: "ok" }),
  fc.constant<XScript>({ kind: "created_no_response" }),
  fc.constant<XScript>({ kind: "fail", failure: { kind: "not_sent" } }),
  fc.constant<XScript>({ kind: "fail", failure: { kind: "no_response" } }),
  fc.constantFrom(400, 401, 429, 503).map<XScript>((status) => ({
    kind: "fail",
    failure: { kind: "http", status, detail: "x", retryAt: null, scope: "user" },
  })),
);

type Step = "due" | "now" | "reconcile" | "advance" | "reconnect";
const steps = fc.array(fc.constantFrom<Step>("due", "now", "reconcile", "advance", "reconnect"), {
  minLength: 1,
  maxLength: 25,
});

/** Each step as the Durable Object runs it: a throw resets the object, and the next call recovers. */
async function play(world: World, plan: readonly Step[]): Promise<void> {
  for (const step of plan) {
    try {
      await playOne(world, step);
    } catch {
      // The DO was reset mid-call (R17): whatever it left is recovered by the next publish call.
    }
  }
}

async function playOne(world: World, step: Step): Promise<void> {
  {
    switch (step) {
      case "due":
        await world.publishPost.publishDue(ACCOUNT, meter(world.clock.now() + HOUR));
        break;
      case "now":
        await world.publishPost.publishNow(ACCOUNT, postId("p-0"), meter(world.clock.now() + HOUR));
        break;
      case "reconcile":
        await world.reconcileAccount.reconcile(ACCOUNT, meter(world.clock.now() + HOUR));
        break;
      case "advance":
        world.clock.advance(2 * MINUTE);
        break;
      case "reconnect": {
        const account = await world.accounts.get(ACCOUNT);
        await world.accounts.save({
          ...(account ?? (await world.seedAccount())),
          status: "ACTIVE",
        });
        await world.gateway.storeConnectedTokens(ACCOUNT, world.tokenEndpoint.issue());
        break;
      }
    }
  }
}

describe("I1 / I4 / R2 / R4: whatever X does, no part reaches X twice", () => {
  it("property: random X outcomes, DO resets and interleavings of publish, reconcile and reconnect", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(scripts, { maxLength: 30 }),
        fc.array(fc.boolean()),
        steps,
        async (outcomes, crashes, plan) => {
          const world = makeWorld();
          await world.seedAccount({ policy: aPolicy({ minGap: 0, dailyCap: 100, grace: HOUR }) });
          seedPosts(world, 3, 2);
          world.x.scripts.create.push(...outcomes);
          const pending = [...crashes];
          const commit = world.writer.commitPart.bind(world.writer);
          world.writer.commitPart = (...args) =>
            pending.shift() === true
              ? Promise.reject(new Error("DO reset after X answered"))
              : commit(...args);
          await play(world, plan);
          const texts = textsOnX(world);
          expect(new Set(texts).size).toBe(texts.length);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("I4: an UNKNOWN part is never re-sent; NOT_FOUND waits for a human's confirmation", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
    seedPosts(world, 1);
    world.x.scripts.create.push({ kind: "fail", failure: { kind: "no_response" } });
    await play(world, [
      "due",
      "due",
      "now",
      "reconcile",
      "advance",
      "due",
      "reconcile",
      "due",
      "now",
    ]);
    expect(world.table.rows.get(postId("p-0"))?.parts[0]?.state.kind).toBe("NOT_FOUND");
    expect(world.x.posts.size).toBe(0);
    const presenter = new Capture<CommandResult<"confirmation_required">>();
    const reschedule = new ReschedulePostInteractor(world.command, world.clock, presenter);
    await reschedule.execute({
      actor: HUMAN,
      postId: postId("p-0"),
      publishAt: T0,
      confirmedNotOnX: true,
    });
    await play(world, ["due"]);
    expect(textsOnX(world)).toStrictEqual(["post 0 part 0"]);
  });
});

describe("I3: nothing is sent for an account that may not publish", () => {
  const statuses: readonly AccountStatus[] = ["PAUSED", "DISCONNECTED", "NEEDS_RECONNECT"];

  it("property: any blocked status or missing disclosure, any publish path", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...statuses, "ACTIVE" as const),
        fc.boolean(),
        fc.boolean(),
        steps,
        async (status, bio, label, plan) => {
          fc.pre(status !== "ACTIVE" || !bio || !label);
          const world = makeWorld();
          await world.seedAccount({
            status,
            disclosure: { bioConfirmed: bio, automatedLabelConfirmed: label },
          });
          seedPosts(world, 2);
          await play(
            world,
            plan.filter((step) => step !== "reconnect"),
          );
          expect(world.x.posts.size).toBe(0);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("I7 / R4: SENDING is in the store before every create reaches X", () => {
  it("for every part of a thread", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
    seedPosts(world, 1, 3);
    const seen: string[] = [];
    world.x.beforeCreate = (_account, text) => {
      const post = world.table.rows.get(postId("p-0"));
      seen.push(post?.parts.find((p) => p.text === text)?.state.kind ?? "missing");
      return Promise.resolve();
    };
    await world.publishPost.publishDue(ACCOUNT, meter());
    expect(seen).toStrictEqual(["SENDING", "SENDING", "SENDING"]);
  });
});
