import type { CreatePersonInputData } from "./input_data";

/** What a controller calls. */
export interface CreatePersonInputBoundary {
  execute(input: CreatePersonInputData): Promise<void>;
}
