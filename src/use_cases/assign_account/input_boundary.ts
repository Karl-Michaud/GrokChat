import type { AssignAccountInputData } from "./input_data";

/** What a controller calls. */
export interface AssignAccountInputBoundary {
  execute(input: AssignAccountInputData): Promise<void>;
}
