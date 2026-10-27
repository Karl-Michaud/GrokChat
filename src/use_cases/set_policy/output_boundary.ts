import type { SetPolicyOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface SetPolicyOutputBoundary {
  present(output: SetPolicyOutputData): void;
}
