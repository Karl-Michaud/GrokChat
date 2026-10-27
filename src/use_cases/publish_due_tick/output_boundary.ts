import type { PublishDueTickOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface PublishDueTickOutputBoundary {
  present(output: PublishDueTickOutputData): void;
}
