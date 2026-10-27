import type { CancelPostInputData } from "./input_data";

/** What a controller calls. */
export interface CancelPostInputBoundary {
  execute(input: CancelPostInputData): Promise<void>;
}
