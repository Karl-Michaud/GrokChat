import type { ListAccountsInputData } from "./input_data";

/** What a controller calls. */
export interface ListAccountsInputBoundary {
  execute(input: ListAccountsInputData): Promise<void>;
}
