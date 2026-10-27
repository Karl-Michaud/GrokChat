import { describe, expect, it } from "vitest";
import { GetHealthInteractor } from "../../../src/use_cases/get_health/interactor";
import type { GetHealthOutputBoundary } from "../../../src/use_cases/get_health/output_boundary";
import type { GetHealthOutputData } from "../../../src/use_cases/get_health/output_data";

class RecordingPresenter implements GetHealthOutputBoundary {
  readonly presented: GetHealthOutputData[] = [];
  present(data: GetHealthOutputData): void {
    this.presented.push(data);
  }
}

describe("GetHealthInteractor", () => {
  it("presents the current health exactly once", () => {
    const presenter = new RecordingPresenter();
    new GetHealthInteractor(presenter).execute();
    expect(presenter.presented).toStrictEqual([{ service: "grokchat", status: "ok" }]);
  });
});
