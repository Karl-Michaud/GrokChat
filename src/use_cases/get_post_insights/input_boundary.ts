import type { GetPostInsightsInputData } from "./input_data";

/** What a controller calls. */
export interface GetPostInsightsInputBoundary {
  execute(input: GetPostInsightsInputData): Promise<void>;
}
