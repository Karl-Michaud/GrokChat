import type { GetPolicyOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetPolicyOutputBoundary {
  present(output: GetPolicyOutputData): void;
}
