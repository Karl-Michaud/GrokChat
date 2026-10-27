import type { GetPostOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetPostOutputBoundary {
  present(output: GetPostOutputData): void;
}
