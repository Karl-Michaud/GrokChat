import type { CostTotalsOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface CostTotalsOutputBoundary {
  present(output: CostTotalsOutputData): void;
}
