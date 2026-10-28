import type { UploadMediaInputData } from "./input_data";

/** What a controller calls. */
export interface UploadMediaInputBoundary {
  execute(input: UploadMediaInputData): Promise<void>;
}
