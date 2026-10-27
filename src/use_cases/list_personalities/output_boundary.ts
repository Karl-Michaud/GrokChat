import type { ListPersonalitiesOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ListPersonalitiesOutputBoundary {
  present(output: ListPersonalitiesOutputData): void;
}
