import type { ListOwnAccountsInputData } from "./input_data";

/** What a controller calls. */
export interface ListOwnAccountsInputBoundary {
  execute(input: ListOwnAccountsInputData): Promise<void>;
}
