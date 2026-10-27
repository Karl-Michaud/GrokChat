import type { ReschedulePostInputData } from "./input_data";

/** What a controller calls. */
export interface ReschedulePostInputBoundary {
  execute(input: ReschedulePostInputData): Promise<void>;
}
