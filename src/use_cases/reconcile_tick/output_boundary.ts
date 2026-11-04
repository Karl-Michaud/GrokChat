import type { ReconcileTickOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ReconcileTickOutputBoundary {
  present(output: ReconcileTickOutputData): void;
}
