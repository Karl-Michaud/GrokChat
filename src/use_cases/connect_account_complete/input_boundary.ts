import type { ConnectAccountCompleteInputData } from "./input_data";

/** What a controller calls. */
export interface ConnectAccountCompleteInputBoundary {
  execute(input: ConnectAccountCompleteInputData): Promise<void>;
}
