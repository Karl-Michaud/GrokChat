import type { GetPersonalityOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetPersonalityOutputBoundary {
  present(output: GetPersonalityOutputData): void;
}
