import type { GetPostMetricsInputData } from "./input_data";

/** What a controller calls. */
export interface GetPostMetricsInputBoundary {
  execute(input: GetPostMetricsInputData): Promise<void>;
}
