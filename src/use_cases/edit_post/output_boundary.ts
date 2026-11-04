import type { EditPostOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface EditPostOutputBoundary {
  present(output: EditPostOutputData): void;
}
