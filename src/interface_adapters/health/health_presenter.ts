import type { GetHealthOutputBoundary } from "../../use_cases/get_health/output_boundary";
import type { GetHealthOutputData } from "../../use_cases/get_health/output_data";
import type { HealthViewModel } from "./health_view_model";

export class HealthPresenter implements GetHealthOutputBoundary {
  constructor(private readonly viewModel: HealthViewModel) {}

  present(data: GetHealthOutputData): void {
    this.viewModel.update({
      httpStatus: 200,
      body: { service: data.service, status: data.status },
    });
  }
}
