import type { GetAnalyticsInputData } from "./input_data";

/** What a controller calls. */
export interface GetAnalyticsInputBoundary {
  execute(input: GetAnalyticsInputData): Promise<void>;
}
