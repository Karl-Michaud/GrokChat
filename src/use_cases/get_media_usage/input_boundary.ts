import type { GetMediaUsageInputData } from "./input_data";

/** What a controller calls. */
export interface GetMediaUsageInputBoundary {
  execute(input: GetMediaUsageInputData): Promise<void>;
}
