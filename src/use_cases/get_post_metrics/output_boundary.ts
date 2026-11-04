import type { GetPostMetricsOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetPostMetricsOutputBoundary {
  present(output: GetPostMetricsOutputData): void;
}
