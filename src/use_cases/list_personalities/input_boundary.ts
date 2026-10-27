import type { ListPersonalitiesInputData } from "./input_data";

/** What a controller calls. */
export interface ListPersonalitiesInputBoundary {
  execute(input: ListPersonalitiesInputData): Promise<void>;
}
