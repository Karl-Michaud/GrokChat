import type { RenamePersonOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface RenamePersonOutputBoundary {
  present(output: RenamePersonOutputData): void;
}
