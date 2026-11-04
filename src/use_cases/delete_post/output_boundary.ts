import type { DeletePostOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface DeletePostOutputBoundary {
  present(output: DeletePostOutputData): void;
}
