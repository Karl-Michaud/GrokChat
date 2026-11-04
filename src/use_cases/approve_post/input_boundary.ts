import type { ApprovePostInputData } from "./input_data";

/** What a controller calls. */
export interface ApprovePostInputBoundary {
  execute(input: ApprovePostInputData): Promise<void>;
}
