import type { ListBacklogInputData } from "./input_data";

/** What a controller calls. */
export interface ListBacklogInputBoundary {
  execute(input: ListBacklogInputData): Promise<void>;
}
