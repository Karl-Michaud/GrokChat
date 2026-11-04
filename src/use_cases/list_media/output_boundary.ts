import type { ListMediaOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ListMediaOutputBoundary {
  present(output: ListMediaOutputData): void;
}
