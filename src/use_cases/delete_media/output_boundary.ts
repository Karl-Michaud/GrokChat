import type { DeleteMediaOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface DeleteMediaOutputBoundary {
  present(output: DeleteMediaOutputData): void;
}
