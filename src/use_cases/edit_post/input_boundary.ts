import type { EditPostInputData } from "./input_data";

/** What a controller calls. */
export interface EditPostInputBoundary {
  execute(input: EditPostInputData): Promise<void>;
}
