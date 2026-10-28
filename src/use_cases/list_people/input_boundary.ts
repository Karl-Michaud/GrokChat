import type { ListPeopleInputData } from "./input_data";

/** What a controller calls. */
export interface ListPeopleInputBoundary {
  execute(input: ListPeopleInputData): Promise<void>;
}
