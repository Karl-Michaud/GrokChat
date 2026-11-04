import type { SetAccountStatusOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface SetAccountStatusOutputBoundary {
  present(output: SetAccountStatusOutputData): void;
}
