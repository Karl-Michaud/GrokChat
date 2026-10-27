import type { StageMediaFromUrlOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface StageMediaFromUrlOutputBoundary {
  present(output: StageMediaFromUrlOutputData): void;
}
