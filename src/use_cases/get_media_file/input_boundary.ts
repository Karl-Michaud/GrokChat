import type { GetMediaFileInputData } from "./input_data";

/** What a controller calls. */
export interface GetMediaFileInputBoundary {
  execute(input: GetMediaFileInputData): Promise<void>;
}
