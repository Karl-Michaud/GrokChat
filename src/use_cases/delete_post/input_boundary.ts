import type { DeletePostInputData } from "./input_data";

/** What a controller calls. */
export interface DeletePostInputBoundary {
  execute(input: DeletePostInputData): Promise<void>;
}
