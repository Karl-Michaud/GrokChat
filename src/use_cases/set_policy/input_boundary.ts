import type { SetPolicyInputData } from "./input_data";

/** What a controller calls. */
export interface SetPolicyInputBoundary {
  execute(input: SetPolicyInputData): Promise<void>;
}
