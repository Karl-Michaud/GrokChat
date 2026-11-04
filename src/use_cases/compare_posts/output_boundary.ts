import type { ComparePostsOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ComparePostsOutputBoundary {
  present(output: ComparePostsOutputData): void;
}
