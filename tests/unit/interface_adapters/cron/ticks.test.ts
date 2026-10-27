import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SystemActor } from "../../../../src/entities/identity/actor";
import { TickController } from "../../../../src/interface_adapters/cron/tick_controller";
import { TickPresenter } from "../../../../src/interface_adapters/cron/tick_presenter";
import { TickViewModel } from "../../../../src/interface_adapters/cron/tick_view_model";

describe("TickController", () => {
  it("runs its use case once, as the system actor named after the job", async () => {
    const seen: SystemActor[] = [];
    const controller = new TickController("publish_due", {
      execute: (input) => {
        seen.push(input.actor);
        return Promise.resolve();
      },
    });
    await expect(controller.run()).resolves.toBe(undefined);
    expect(seen).toStrictEqual([{ kind: "system", job: "publish_due" }]);
  });

  it("passes a failing use case's rejection on", async () => {
    const controller = new TickController("reconcile", {
      execute: () => Promise.reject(new Error("D1 down")),
    });
    await expect(controller.run()).rejects.toThrow("D1 down");
  });
});

describe("TickPresenter", () => {
  const present = (output: Parameters<TickPresenter["present"]>[0]): string | undefined => {
    const view = new TickViewModel();
    new TickPresenter(view).present(output);
    return view.current()?.line;
  };

  it("one line per tick: the job, then every count in the summary's order", () => {
    expect(
      present({ job: "publish_due", dispatched: 3, waiting: 1, stoppedForAppLimit: true }),
    ).toBe("tick publish_due: dispatched=3 waiting=1 stoppedForAppLimit=true");
    expect(present({ job: "reconcile", dispatched: 0, waiting: 0, found: 2, notFound: 1 })).toBe(
      "tick reconcile: dispatched=0 waiting=0 found=2 notFound=1",
    );
    expect(present({ job: "metrics", dispatched: 1, waiting: 0, read: 5, mediaDeleted: 2 })).toBe(
      "tick metrics: dispatched=1 waiting=0 read=5 mediaDeleted=2",
    );
  });
});

describe("TickPresenter, for any summary", () => {
  it("names the job once and lists every count as name=value, in order", () => {
    const count = fc.nat({ max: 10_000 });
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z_]{1,12}$/),
        count,
        count,
        count,
        count,
        (job, dispatched, waiting, read, mediaDeleted) => {
          const view = new TickViewModel();
          new TickPresenter(view).present({ job, dispatched, waiting, read, mediaDeleted });
          expect(view.current()?.line).toBe(
            `tick ${job}: dispatched=${String(dispatched)} waiting=${String(waiting)} ` +
              `read=${String(read)} mediaDeleted=${String(mediaDeleted)}`,
          );
        },
      ),
    );
  });
});

describe("TickViewModel", () => {
  it("is null until a presenter writes it, then holds the last view", () => {
    const view = new TickViewModel();
    expect(view.current()).toBeNull();
    view.update({ line: "a" });
    view.update({ line: "b" });
    expect(view.current()).toStrictEqual({ line: "b" });
  });
});
