import type { ConnectAccountCompleteOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ConnectAccountCompleteOutputBoundary {
  present(output: ConnectAccountCompleteOutputData): void;
}
