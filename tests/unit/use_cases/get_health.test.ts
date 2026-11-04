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

const counting = (n: number) => ({ publishingCount: () => Promise.resolve(n) });

describe("GetHealthInteractor", () => {
  it("presents the current health and the PUBLISHING count exactly once", async () => {
    const presenter = new RecordingPresenter();
    await new GetHealthInteractor(counting(3), presenter).execute();
    expect(presenter.presented).toStrictEqual([
      { service: "grokchat", status: "ok", publishing: 3 },
    ]);
  });

  it("reports 0 when nothing is publishing: the time to deploy (m7)", async () => {
    const presenter = new RecordingPresenter();
    await new GetHealthInteractor(counting(0), presenter).execute();
    expect(presenter.presented).toStrictEqual([
      { service: "grokchat", status: "ok", publishing: 0 },
    ]);
  });
});
