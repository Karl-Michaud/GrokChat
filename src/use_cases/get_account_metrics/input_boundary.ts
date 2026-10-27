import type { GetAccountMetricsInputData } from "./input_data";

/** What a controller calls. */
export interface GetAccountMetricsInputBoundary {
  execute(input: GetAccountMetricsInputData): Promise<void>;
}
