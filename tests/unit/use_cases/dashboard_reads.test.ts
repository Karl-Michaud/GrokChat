import { describe, expect, it } from "vitest";
import { R2_FREE_ALLOWANCE, R2_GUARDS } from "../../../src/entities/media/r2_quota";
import { MINUTE } from "../../../src/entities/time/instant";
import { GetMediaUsageInteractor } from "../../../src/use_cases/get_media_usage/interactor";
import type { GetMediaUsageOutputData } from "../../../src/use_cases/get_media_usage/output_data";
import { ListAccountsInteractor } from "../../../src/use_cases/list_accounts/interactor";
import type { ListAccountsOutputData } from "../../../src/use_cases/list_accounts/output_data";
import { LoginInteractor } from "../../../src/use_cases/login/interactor";
import type { LoginOutputData } from "../../../src/use_cases/login/output_data";
import type { PasswordVerifier } from "../../../src/use_cases/ports/password_verifier";
import { botActor, HUMAN, T0 } from "../support/builders";
import { Capture, makeWorld, type World } from "../support/world";

class CountingVerifier implements PasswordVerifier {
  calls = 0;

  constructor(private readonly secret: string) {}

  verify(password: string): Promise<boolean> {
    this.calls += 1;
    return Promise.resolve(password === this.secret);
  }
}

function login(world: World, verifier: PasswordVerifier) {
  const presenter = new Capture<LoginOutputData>();
  const interactor = new LoginInteractor(
    { throttle: world.throttle, verifier, audit: world.actionAudit, clock: world.clock },
    presenter,
  );
  const attempt = async (password: string, clientKey = "1.2.3.4") => {
    await interactor.execute({ actor: HUMAN, password, clientKey });
    return presenter.last;
  };
  return attempt;
}

describe("login", () => {
  it("accepts the right password and audits it", async () => {
    const world = makeWorld();
    const attempt = login(world, new CountingVerifier("pw"));
    expect(await attempt("pw")).toStrictEqual({ ok: true });
    expect(world.audit.events).toStrictEqual([
      {
        at: T0,
        actor: "human:owner",
        action: "session.login",
        accountId: null,
        postId: null,
        detail: "",
      },
    ]);
    expect(world.throttle.failures.size).toBe(0);
  });

  it("counts a wrong password against the client and the global key, and audits the refusal", async () => {
    const world = makeWorld();
    const attempt = login(world, new CountingVerifier("pw"));
    expect(await attempt("nope")).toStrictEqual({ ok: false, code: "wrong_password" });
    expect([...world.throttle.failures.entries()]).toStrictEqual([
      ["ip:1.2.3.4", [T0]],
      ["global", [T0]],
    ]);
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      ["refused.session.login", "wrong_password"],
    ]);
    expect(JSON.stringify(world.audit.events)).not.toContain("nope");
  });

  it("throttles a client after five failures without hashing again (R12)", async () => {
    const world = makeWorld();
    const verifier = new CountingVerifier("pw");
    const attempt = login(world, verifier);
    for (let i = 0; i < 5; i += 1) {
      expect(await attempt("bad")).toStrictEqual({ ok: false, code: "wrong_password" });
    }
    expect(await attempt("pw")).toStrictEqual({ ok: false, code: "throttled" });
    expect(verifier.calls).toBe(5);
    expect(world.audit.events.at(-1)?.detail).toBe("throttled");
    world.clock.advance(15 * MINUTE);
    expect(await attempt("pw")).toStrictEqual({ ok: true });
  });

  it("throttles every client once the global key is full", async () => {
    const world = makeWorld();
    const attempt = login(world, new CountingVerifier("pw"));
    for (let i = 0; i < 5; i += 1) {
      await attempt("bad", `10.0.0.${String(i)}`);
    }
    expect(await attempt("pw", "10.9.9.9")).toStrictEqual({ ok: false, code: "throttled" });
    expect(world.throttle.failures.has("ip:10.9.9.9")).toBe(false);
  });
});

describe("listAccounts, getMediaUsage", () => {
  it("lists every account for a human and refuses a bot", async () => {
    const world = makeWorld();
    const account = await world.seedAccount();
    const presenter = new Capture<ListAccountsOutputData>();
    const list = new ListAccountsInteractor(world.accounts, world.guard, presenter);
    await list.execute({ actor: HUMAN });
    expect(presenter.last).toStrictEqual({ ok: true, accounts: [account] });
    await list.execute({ actor: botActor() });
    expect(presenter.last).toStrictEqual({ ok: false, code: "human_only" });
    expect(world.audit.events.map((event) => event.action)).toStrictEqual(["refused.account.list"]);
  });

  it("shows this month's R2 use against the guards and the free allowance", async () => {
    const world = makeWorld();
    await world.usage.record({ storedBytes: 1_000, classA: 2, classB: 3 }, T0);
    const presenter = new Capture<GetMediaUsageOutputData>();
    const usage = new GetMediaUsageInteractor(world.usage, world.guard, world.clock, presenter);
    await usage.execute({ actor: HUMAN });
    expect(presenter.last).toStrictEqual({
      ok: true,
      usage: { month: "2026-10", storedBytes: 1_000, classA: 2, classB: 3 },
      guards: R2_GUARDS,
      allowance: R2_FREE_ALLOWANCE,
    });
    world.clock.set(Date.UTC(2026, 10, 2));
    await usage.execute({ actor: HUMAN });
    expect(presenter.last).toMatchObject({
      usage: { month: "2026-11", storedBytes: 1_000, classA: 0, classB: 0 },
    });
    await usage.execute({ actor: botActor() });
    expect(presenter.last).toStrictEqual({ ok: false, code: "human_only" });
    expect(world.audit.events.map((event) => event.action)).toStrictEqual(["refused.media.usage"]);
  });

  it("the free allowance sits above every guard", () => {
    expect(R2_FREE_ALLOWANCE).toStrictEqual({
      storedBytes: 10_000_000_000,
      classA: 1_000_000,
      classB: 10_000_000,
    });
    expect(R2_GUARDS.storedBytes).toBeLessThan(R2_FREE_ALLOWANCE.storedBytes);
    expect(R2_GUARDS.classA).toBeLessThan(R2_FREE_ALLOWANCE.classA);
    expect(R2_GUARDS.classB).toBeLessThan(R2_FREE_ALLOWANCE.classB);
  });
});
