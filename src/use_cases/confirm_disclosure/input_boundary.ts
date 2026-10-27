import type { ConfirmDisclosureInputData } from "./input_data";

/** What a controller calls. */
export interface ConfirmDisclosureInputBoundary {
  execute(input: ConfirmDisclosureInputData): Promise<void>;
}
