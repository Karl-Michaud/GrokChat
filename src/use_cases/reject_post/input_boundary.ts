import type { RejectPostInputData } from "./input_data";

/** What a controller calls. */
export interface RejectPostInputBoundary {
  execute(input: RejectPostInputData): Promise<void>;
}
