import type { AssignAccountOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface AssignAccountOutputBoundary {
  present(output: AssignAccountOutputData): void;
}
