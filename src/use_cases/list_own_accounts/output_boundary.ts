import type { ListOwnAccountsOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ListOwnAccountsOutputBoundary {
  present(output: ListOwnAccountsOutputData): void;
}
