import type { ReconcileTickInputData } from "./input_data";

/** What a controller calls. */
export interface ReconcileTickInputBoundary {
  execute(input: ReconcileTickInputData): Promise<void>;
}
