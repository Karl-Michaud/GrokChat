import type { CreatePersonOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface CreatePersonOutputBoundary {
  present(output: CreatePersonOutputData): void;
}
