import type { RejectPostOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface RejectPostOutputBoundary {
  present(output: RejectPostOutputData): void;
}
