import type { ListPostsInputData } from "./input_data";

/** What a controller calls. */
export interface ListPostsInputBoundary {
  execute(input: ListPostsInputData): Promise<void>;
}
