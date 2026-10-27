import type { LoginOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface LoginOutputBoundary {
  present(output: LoginOutputData): void;
}
