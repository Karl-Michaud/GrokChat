import type { IssuePersonTokenOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface IssuePersonTokenOutputBoundary {
  present(output: IssuePersonTokenOutputData): void;
}
