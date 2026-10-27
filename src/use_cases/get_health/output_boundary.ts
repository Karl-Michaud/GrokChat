import type { GetHealthOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetHealthOutputBoundary {
  present(data: GetHealthOutputData): void;
}
