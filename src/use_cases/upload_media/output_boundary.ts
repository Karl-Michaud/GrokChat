import type { UploadMediaOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface UploadMediaOutputBoundary {
  present(output: UploadMediaOutputData): void;
}
