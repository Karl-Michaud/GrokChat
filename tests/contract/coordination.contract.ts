/** Contracts for the locks, single-flight, the budget meter, the clock and the id generator. */
import { expect, it } from "vitest";
import { SECOND } from "../../src/entities/time/instant";
import type { BudgetMeter } from "../../src/use_cases/ports/budget_meter";
import type { Clock } from "../../src/use_cases/ports/clock";
import type { IdGenerator } from "../../src/use_cases/ports/id_generator";
import type { Locks } from "../../src/use_cases/ports/locks";
import type { SingleFlight } from "../../src/use_cases/ports/single_flight";
import { T0 } from "../unit/support/builders";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

export function locksContract(
  make: () => { readonly locks: Locks; readonly advance: (ms: number) => void },
): void {
  it("each lock serialises its runs across await (plan §1.1: the DO does not)", async () => {
    const { locks } = make();
    for (const lock of [
      (fn: () => Promise<void>) => locks.publish.run(fn, null),
      (fn: () => Promise<void>) => locks.token.run(fn),
    ]) {
      let inside = 0;
      let most = 0;
      await Promise.all(
        Array.from({ length: 5 }, () =>
          lock(async () => {
            inside += 1;
            most = Math.max(most, inside);
            await tick();
            inside -= 1;
          }),
        ),
      );
      expect(most).toBe(1);
    }
  });

  it("returns the value, frees the lock after a throw, and gives up a wait past its deadline", async () => {
    const { locks, advance } = make();
    expect(await locks.token.run(() => Promise.resolve(7))).toBe(7);
    expect(await locks.publish.run(() => Promise.resolve(8), null)).toStrictEqual({
      acquired: true,
      value: 8,
    });
    await expect(locks.publish.run(() => Promise.reject(new Error("reset")), null)).rejects.toThrow(
      "reset",
    );
    expect(await locks.publish.run(() => Promise.resolve(9), T0)).toStrictEqual({
      acquired: true,
      value: 9,
    });
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = locks.publish.run(() => gate, null);
    const waiting = locks.publish.run(() => Promise.resolve(1), T0 + SECOND);
    advance(2 * SECOND);
    release();
    await held;
    expect(await waiting).toStrictEqual({ acquired: false });
  });
}

export function singleFlightContract(make: () => SingleFlight): void {
  it("a second run of the same key while one runs is skipped; other keys and later runs go ahead", async () => {
    const flights = make();
    const slow = () => tick().then(() => "done");
    const [a, b, c] = await Promise.all([
      flights.tryRun("k", slow),
      flights.tryRun("k", slow),
      flights.tryRun("j", slow),
    ]);
    expect([a, b, c]).toStrictEqual([
      { ran: true, value: "done" },
      { ran: false },
      { ran: true, value: "done" },
    ]);
    await expect(flights.tryRun("k", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await flights.tryRun("k", () => Promise.resolve(1))).toStrictEqual({
      ran: true,
      value: 1,
    });
  });
}

export function budgetMeterContract(make: () => BudgetMeter): void {
  it("fits within the remaining pools and deadline; spend takes from the pools", () => {
    const meter = make();
    const start = meter.remaining();
    expect(
      meter.fits({ cloudflareCalls: start.cloudflareCalls, externalSubrequests: 0, millis: 0 }, T0),
    ).toBe(true);
    meter.spend({ cloudflareCalls: 1, externalSubrequests: 1 });
    expect(meter.remaining()).toStrictEqual({
      deadline: start.deadline,
      cloudflareCalls: start.cloudflareCalls - 1,
      externalSubrequests: start.externalSubrequests - 1,
    });
    expect(
      meter.fits({ cloudflareCalls: start.cloudflareCalls, externalSubrequests: 0, millis: 0 }, T0),
    ).toBe(false);
    expect(
      meter.fits(
        { cloudflareCalls: 0, externalSubrequests: 0, millis: start.deadline - T0 + 1 },
        T0,
      ),
    ).toBe(false);
  });
}

export function clockAndIdsContract(
  make: () => { readonly clock: Clock; readonly ids: IdGenerator },
): void {
  it("the clock reads an instant; ids are unique", () => {
    const { clock, ids } = make();
    expect(Number.isFinite(clock.now())).toBe(true);
    const many = Array.from({ length: 50 }, () => ids.newId());
    expect(new Set(many).size).toBe(50);
  });
}
