import type { ListPeopleOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ListPeopleOutputBoundary {
  present(output: ListPeopleOutputData): void;
}
