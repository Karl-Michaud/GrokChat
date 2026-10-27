import type { ListAccountsOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ListAccountsOutputBoundary {
  present(output: ListAccountsOutputData): void;
}
