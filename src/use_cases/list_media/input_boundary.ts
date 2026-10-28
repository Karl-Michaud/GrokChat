import type { ListMediaInputData } from "./input_data";

/** What a controller calls. */
export interface ListMediaInputBoundary {
  execute(input: ListMediaInputData): Promise<void>;
}
