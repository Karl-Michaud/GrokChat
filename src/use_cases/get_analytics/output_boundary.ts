import type { GetAnalyticsOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetAnalyticsOutputBoundary {
  present(output: GetAnalyticsOutputData): void;
}
