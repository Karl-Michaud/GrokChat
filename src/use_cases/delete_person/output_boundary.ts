import type { DeletePersonOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface DeletePersonOutputBoundary {
  present(output: DeletePersonOutputData): void;
}
