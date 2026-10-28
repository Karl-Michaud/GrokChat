import type { ListActivityOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ListActivityOutputBoundary {
  present(output: ListActivityOutputData): void;
}
