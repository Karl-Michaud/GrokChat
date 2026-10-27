import type { MetricsTickOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface MetricsTickOutputBoundary {
  present(output: MetricsTickOutputData): void;
}
