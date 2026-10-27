import type { SetAccountStatusInputData } from "./input_data";

/** What a controller calls. */
export interface SetAccountStatusInputBoundary {
  execute(input: SetAccountStatusInputData): Promise<void>;
}
