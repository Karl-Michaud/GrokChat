import type { ListPostsOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface ListPostsOutputBoundary {
  present(output: ListPostsOutputData): void;
}
