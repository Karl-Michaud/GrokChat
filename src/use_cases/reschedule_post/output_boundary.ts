import type { ReschedulePostOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ReschedulePostOutputBoundary {
  present(output: ReschedulePostOutputData): void;
}
