import type { CostTotalsInputData } from "./input_data";

/** What a controller calls. */
export interface CostTotalsInputBoundary {
  execute(input: CostTotalsInputData): Promise<void>;
}
