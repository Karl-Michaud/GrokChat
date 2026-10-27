import type { PublishDueTickInputData } from "./input_data";

/** What a controller calls. */
export interface PublishDueTickInputBoundary {
  execute(input: PublishDueTickInputData): Promise<void>;
}
