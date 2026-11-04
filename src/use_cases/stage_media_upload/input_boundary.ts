import type { StageMediaUploadInputData } from "./input_data";

/** What a controller calls. */
export interface StageMediaUploadInputBoundary {
  execute(input: StageMediaUploadInputData): Promise<void>;
}
