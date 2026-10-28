import type { DeleteMediaInputData } from "./input_data";

/** What a controller calls. */
export interface DeleteMediaInputBoundary {
  execute(input: DeleteMediaInputData): Promise<void>;
}
