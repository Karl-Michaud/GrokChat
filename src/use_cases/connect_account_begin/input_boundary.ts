import type { ConnectAccountBeginInputData } from "./input_data";

/** What a controller calls. */
export interface ConnectAccountBeginInputBoundary {
  execute(input: ConnectAccountBeginInputData): Promise<void>;
}
