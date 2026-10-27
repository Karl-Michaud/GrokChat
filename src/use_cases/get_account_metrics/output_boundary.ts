import type { GetAccountMetricsOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetAccountMetricsOutputBoundary {
  present(output: GetAccountMetricsOutputData): void;
}
