import type { SavePersonalityOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface SavePersonalityOutputBoundary {
  present(output: SavePersonalityOutputData): void;
}
