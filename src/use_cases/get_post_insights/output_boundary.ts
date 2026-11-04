import type { GetPostInsightsOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetPostInsightsOutputBoundary {
  present(output: GetPostInsightsOutputData): void;
}
