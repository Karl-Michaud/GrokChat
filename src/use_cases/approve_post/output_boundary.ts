import type { ApprovePostOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ApprovePostOutputBoundary {
  present(output: ApprovePostOutputData): void;
}
