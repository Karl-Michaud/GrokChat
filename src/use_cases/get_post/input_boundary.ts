import type { GetPostInputData } from "./input_data";

/** What a controller calls. */
export interface GetPostInputBoundary {
  execute(input: GetPostInputData): Promise<void>;
}
