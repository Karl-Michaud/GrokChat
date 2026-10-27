import type { CancelPostOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface CancelPostOutputBoundary {
  present(output: CancelPostOutputData): void;
}
