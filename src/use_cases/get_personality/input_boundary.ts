import type { GetPersonalityInputData } from "./input_data";

/** What a controller calls. */
export interface GetPersonalityInputBoundary {
  execute(input: GetPersonalityInputData): Promise<void>;
}
