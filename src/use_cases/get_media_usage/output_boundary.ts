import type { GetMediaUsageOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetMediaUsageOutputBoundary {
  present(output: GetMediaUsageOutputData): void;
}
