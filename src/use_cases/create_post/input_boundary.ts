import type { CreatePostInputData } from "./input_data";

/** What a controller calls. */
export interface CreatePostInputBoundary {
  execute(input: CreatePostInputData): Promise<void>;
}
