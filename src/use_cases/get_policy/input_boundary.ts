import type { GetPolicyInputData } from "./input_data";

/** What a controller calls. */
export interface GetPolicyInputBoundary {
  execute(input: GetPolicyInputData): Promise<void>;
}
