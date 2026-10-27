import type { StageMediaUploadOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface StageMediaUploadOutputBoundary {
  present(output: StageMediaUploadOutputData): void;
}
