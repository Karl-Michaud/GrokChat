import type { StageMediaFromUrlInputData } from "./input_data";

/** What a controller calls. */
export interface StageMediaFromUrlInputBoundary {
  execute(input: StageMediaFromUrlInputData): Promise<void>;
}
