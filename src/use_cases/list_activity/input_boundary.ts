import type { ListActivityInputData } from "./input_data";

/** What a controller calls. */
export interface ListActivityInputBoundary {
  execute(input: ListActivityInputData): Promise<void>;
}
