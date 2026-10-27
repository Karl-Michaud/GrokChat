import type { GetHealthInputBoundary } from "../../use_cases/get_health/input_boundary";

/** Framework-free: the HTTP route calls this with plain values (here, none). */
export class HealthController {
  constructor(private readonly useCase: GetHealthInputBoundary) {}

  health(): Promise<void> {
    return this.useCase.execute();
  }
}
