import type { CreatePostOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface CreatePostOutputBoundary {
  present(output: CreatePostOutputData): void;
}
