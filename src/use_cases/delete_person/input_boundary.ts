import type { DeletePersonInputData } from "./input_data";

/** What a controller calls. */
export interface DeletePersonInputBoundary {
  execute(input: DeletePersonInputData): Promise<void>;
}
