import type { LoginInputData } from "./input_data";

/** What a controller calls. */
export interface LoginInputBoundary {
  execute(input: LoginInputData): Promise<void>;
}
