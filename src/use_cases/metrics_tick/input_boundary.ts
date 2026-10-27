import type { MetricsTickInputData } from "./input_data";

/** What a controller calls. */
export interface MetricsTickInputBoundary {
  execute(input: MetricsTickInputData): Promise<void>;
}
