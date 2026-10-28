import type { IssuePersonTokenInputData } from "./input_data";

/** What a controller calls. */
export interface IssuePersonTokenInputBoundary {
  execute(input: IssuePersonTokenInputData): Promise<void>;
}
