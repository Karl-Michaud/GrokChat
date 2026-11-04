import type { RenamePersonInputData } from "./input_data";

/** What a controller calls. */
export interface RenamePersonInputBoundary {
  execute(input: RenamePersonInputData): Promise<void>;
}
