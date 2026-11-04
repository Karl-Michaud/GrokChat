import { describe, expect, it } from "vitest";
import { HealthController } from "../../../src/interface_adapters/health/health_controller";
import { HealthPresenter } from "../../../src/interface_adapters/health/health_presenter";
import { HealthViewModel } from "../../../src/interface_adapters/health/health_view_model";
import type { GetHealthInputBoundary } from "../../../src/use_cases/get_health/input_boundary";

describe("HealthPresenter", () => {
  it("turns the output data into a 200 view", () => {
    const viewModel = new HealthViewModel();
    new HealthPresenter(viewModel).present({ service: "grokchat", status: "ok", publishing: 2 });
    expect(viewModel.current()).toStrictEqual({
      httpStatus: 200,
      body: { service: "grokchat", status: "ok", publishing: 2 },
    });
  });
});

describe("HealthViewModel", () => {
  it("refuses to be read before a presenter wrote it", () => {
    expect(() => new HealthViewModel().current()).toThrow(
      "HealthViewModel was read before a presenter wrote it",
    );
  });
});

describe("HealthController", () => {
  it("runs the use case once per request, and waits for it", async () => {
    let calls = 0;
    const useCase: GetHealthInputBoundary = {
      execute: async () => {
        await Promise.resolve();
        calls += 1;
      },
    };
    await new HealthController(useCase).health();
    expect(calls).toBe(1);
  });
});
