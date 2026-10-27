import { currentHealth } from "../../entities/health";
import type { GetHealthInputBoundary } from "./input_boundary";
import type { GetHealthOutputBoundary } from "./output_boundary";

export class GetHealthInteractor implements GetHealthInputBoundary {
  constructor(private readonly presenter: GetHealthOutputBoundary) {}

  execute(): void {
    const health = currentHealth();
    this.presenter.present({ service: health.service, status: health.status });
  }
}
