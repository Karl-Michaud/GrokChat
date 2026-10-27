import type { ConnectAccountBeginOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ConnectAccountBeginOutputBoundary {
  present(output: ConnectAccountBeginOutputData): void;
}
