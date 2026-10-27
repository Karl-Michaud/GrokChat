import type { ComparePostsInputData } from "./input_data";

/** What a controller calls. */
export interface ComparePostsInputBoundary {
  execute(input: ComparePostsInputData): Promise<void>;
}
