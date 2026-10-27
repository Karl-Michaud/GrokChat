import type { ConfirmDisclosureOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ConfirmDisclosureOutputBoundary {
  present(output: ConfirmDisclosureOutputData): void;
}
