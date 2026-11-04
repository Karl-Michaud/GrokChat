import type { ListBacklogOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ListBacklogOutputBoundary {
  present(output: ListBacklogOutputData): void;
}
