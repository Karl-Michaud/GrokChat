import type { GetCalendarInputData } from "./input_data";

/** What a controller calls. */
export interface GetCalendarInputBoundary {
  execute(input: GetCalendarInputData): Promise<void>;
}
